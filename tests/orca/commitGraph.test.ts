import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createCommitGraphWriter,
  fileExists,
  gitRunner,
  RETRY_AFTER_MS,
  SLOW_LOG_MS,
  type CommitGraphDeps
} from "@/orca/worker/commitGraph";

/** Fakes for everything outside the writer, so each rule can be checked on its own. */
function setup(
  options: { present?: boolean; failures?: Record<string, number>; enabled?: boolean } = {}
) {
  const calls: string[][] = [];
  let writeFails = false;
  const deps: CommitGraphDeps = {
    git: vi.fn(async (_repo: string, args: readonly string[]) => {
      calls.push([...args]);
      if (args[0] === "rev-parse") {
        return `.git/${args[2]}\n`;
      }
      if (writeFails) {
        throw new Error("fatal: unable to write");
      }
      return "";
    }),
    exists: vi.fn(() => options.present ?? false),
    now: vi.fn(() => 1_000_000),
    loadFailures: vi.fn(async () => options.failures ?? {}),
    saveFailure: vi.fn(async () => undefined),
    log: vi.fn()
  };
  const writer = createCommitGraphWriter(deps, () => options.enabled ?? true);
  return {
    writer,
    deps,
    calls,
    failWrites: () => {
      writeFails = true;
    },
    writes: () => calls.filter((args) => args[0] === "commit-graph")
  };
}

describe("createCommitGraphWriter", () => {
  it("does nothing when the setting is off", async () => {
    const { writer, calls } = setup({ enabled: false });

    expect(await writer.consider("/repo", 5000)).toBe("disabled");
    expect(calls).toEqual([]);
  });

  it("leaves a repository alone while its log is quick", async () => {
    const { writer, calls } = setup();

    expect(await writer.consider("/repo", SLOW_LOG_MS - 1)).toBe("fast");
    expect(calls).toEqual([]);
  });

  it("writes one for a slow log, with the arguments that make it incremental and quiet", async () => {
    const { writer, writes } = setup();

    expect(await writer.consider("/repo", SLOW_LOG_MS)).toBe("written");

    expect(writes()).toEqual([
      ["commit-graph", "write", "--reachable", "--split", "--no-progress"]
    ]);
  });

  it("does not write one when the repository has one", async () => {
    const { writer, writes } = setup({ present: true });

    expect(await writer.consider("/repo", 5000)).toBe("present");
    expect(writes()).toEqual([]);
  });

  it("looks for the file where git keeps it, which for a worktree is the main repository", async () => {
    const { writer, deps } = setup();
    await writer.consider("/repo", 5000);

    expect(deps.git).toHaveBeenCalledWith("/repo", [
      "rev-parse",
      "--git-path",
      "objects/info/commit-graph"
    ]);
    expect(deps.git).toHaveBeenCalledWith("/repo", [
      "rev-parse",
      "--git-path",
      "objects/info/commit-graphs/commit-graph-chain"
    ]);
  });

  it("looks at a repository once per run, however many slow logs follow", async () => {
    const { writer, writes } = setup();

    expect(await writer.consider("/repo", 5000)).toBe("written");
    expect(await writer.consider("/repo", 5000)).toBe("checked");
    expect(writes()).toHaveLength(1);
  });

  it("treats each repository separately", async () => {
    const { writer, writes } = setup();

    await writer.consider("/one", 5000);
    await writer.consider("/two", 5000);

    expect(writes()).toHaveLength(2);
  });

  it("does not start a second write while one is running", async () => {
    const { writer, deps } = setup();
    const write = Promise.withResolvers<void>();
    let writeStarted = false;
    let writes = 0;
    vi.mocked(deps.git).mockImplementation(async (_repo, args) => {
      if (args[0] === "rev-parse") {
        return ".git/x\n";
      }
      writes++;
      writeStarted = true;
      await write.promise;
      return "";
    });

    const first = writer.consider("/repo", 5000);
    await vi.waitFor(() => expect(writeStarted).toBe(true));
    expect(await writer.consider("/repo", 5000)).toBe("checked");
    write.resolve();

    expect(await first).toBe("written");
    expect(writes).toBe(1);
  });

  it("remembers a failure, and does not try that repository again for a day", async () => {
    const failing = setup();
    failing.failWrites();

    expect(await failing.writer.consider("/repo", 5000)).toBe("failed");
    expect(failing.deps.saveFailure).toHaveBeenCalledWith("/repo", 1_000_000);

    const later = setup({ failures: { "/repo": 1_000_000 - RETRY_AFTER_MS + 1 } });
    expect(await later.writer.consider("/repo", 5000)).toBe("backoff");
    expect(later.writes()).toEqual([]);
  });

  it("tries again once the day is up", async () => {
    const { writer } = setup({ failures: { "/repo": 1_000_000 - RETRY_AFTER_MS } });

    expect(await writer.consider("/repo", 5000)).toBe("written");
  });

  it("does not let a failure to remember a failure get out", async () => {
    const { writer, deps, failWrites } = setup();
    failWrites();
    vi.mocked(deps.saveFailure).mockRejectedValue(new Error("storage is full"));

    expect(await writer.consider("/repo", 5000)).toBe("failed");
  });
});

/** A writer with the real git and file system, and nothing remembered. */
const realWriter = () =>
  createCommitGraphWriter(
    {
      git: gitRunner(() => "git"),
      exists: fileExists,
      now: Date.now,
      loadFailures: async () => ({}),
      saveFailure: async () => undefined,
      log: () => undefined
    },
    () => true
  );

describe("with a real repository", () => {
  let dir: string;

  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "T",
        GIT_AUTHOR_EMAIL: "t@e.c",
        GIT_COMMITTER_NAME: "T",
        GIT_COMMITTER_EMAIL: "t@e.c",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null"
      }
    }).trim();

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gg-cg-"));
    git("init", "-q", "-b", "main");
    for (let index = 1; index <= 20; index++) {
      git("commit", "-q", "--allow-empty", "-m", `commit ${index}`);
    }
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes a commit-graph that git accepts, and a second look finds it", async () => {
    expect(fs.existsSync(path.join(dir, ".git/objects/info/commit-graphs"))).toBe(false);

    expect(await realWriter().consider(dir, SLOW_LOG_MS)).toBe("written");

    expect(
      fs.existsSync(path.join(dir, ".git/objects/info/commit-graphs/commit-graph-chain"))
    ).toBe(true);
    expect(() => git("commit-graph", "verify")).not.toThrow();
    // A new run of the worker finds the file and leaves it.
    expect(await realWriter().consider(dir, SLOW_LOG_MS)).toBe("present");
  });

  it("finds the file from a linked worktree, where it lives in the main repository", async () => {
    const worktree = path.join(dir, "..", `${path.basename(dir)}-wt`);
    git("worktree", "add", "-q", "-b", "side", worktree);
    try {
      await realWriter().consider(dir, SLOW_LOG_MS);

      expect(await realWriter().consider(worktree, SLOW_LOG_MS)).toBe("present");
    } finally {
      fs.rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("does not change what git log shows", async () => {
    const before = git("log", "--format=%H", "--date-order");

    await realWriter().consider(dir, SLOW_LOG_MS);

    expect(git("log", "--format=%H", "--date-order")).toBe(before);
  });
});
