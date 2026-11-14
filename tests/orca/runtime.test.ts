import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GitCommitDetails, GitCommitNode } from "@/backend/types";
import type { OrcaWorkerApi } from "@/orca/types/orca-api";
import { createRuntime, type Runtime } from "@/orca/worker/runtime";
import { findWorkspacePathForTerminals } from "@/orca/worker/terminals";
import type { Workspace } from "@/orca/worker/workspaces";

vi.mock("@/orca/worker/terminals", () => ({ findWorkspacePathForTerminals: vi.fn() }));

/**
 * Runs the worker's runtime against a real repository with the real `git`: what the panel's
 * requests do, minus Orca itself.
 */

const IDENTITY = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com"
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...IDENTITY,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null"
    }
  }).trim();
}

type Post = { event: string; payload: { name: string; message: unknown } };

const unwrap = <T>(answer: unknown): T => (answer as { data: T }).data;

/** A `workspace.changed` payload for a focused workspace. */
const focusContext = (
  workspaceId: string,
  displayName: string,
  terminals: { id: string }[] = []
) => ({
  context: { workspaceId, branch: "main", displayName, terminals }
});

/**
 * A `workspace.changed` payload as Orca 1.4.x sends it: the focused workspace's name, branch and
 * terminals, with no workspace id.
 */
const idlessContext = (displayName: string, terminals: { id: string }[] = [], branch = "main") => ({
  context: { branch, displayName, terminals }
});

function fakeOrca(
  repo: string,
  settings: Record<string, unknown> = {},
  extraWorkspaces: Workspace[] = []
) {
  const stored = new Map<string, unknown>();
  const posts: Post[] = [];
  const orca = {
    host: {
      call: vi.fn(async (method: string) => {
        switch (method) {
          case "workspace.list":
            return {
              workspaces: [
                {
                  id: "w1",
                  kind: "worktree",
                  name: "repo",
                  path: repo,
                  branch: "main",
                  hostId: null
                },
                ...extraWorkspaces,
                {
                  id: "w2",
                  kind: "worktree",
                  name: "far",
                  path: "/nowhere",
                  branch: "main",
                  hostId: "ssh:box"
                }
              ]
            };
          case "workspace.readContext":
            return { workspaceId: "w1", branch: "main", displayName: "repo", terminals: [] };
          case "settings.get":
            return { settings };
          default:
            throw new Error(`unexpected host call ${method}`);
        }
      }),
      has: () => true
    },
    panels: {
      handle: vi.fn(),
      post: vi.fn((event: string, payload: unknown) => {
        posts.push({ event, payload } as Post);
      })
    },
    storage: {
      get: vi.fn(async (key: string) => stored.get(key)),
      set: vi.fn(async (key: string, value: unknown) => {
        stored.set(key, value);
      })
    },
    events: { on: vi.fn() },
    log: vi.fn()
  } satisfies OrcaWorkerApi;
  return { orca, posts, stored };
}

describe("worker runtime, on a real repository", () => {
  let dir: string;
  let repo: string;
  let runtime: Runtime;
  let posts: Post[];
  let stored: Map<string, unknown>;
  let headHash: string;
  let firstHash: string;
  /** A second local workspace, so a switch of focus has somewhere to go. */
  let second: string;

  const messages = async (message: Record<string, unknown>) =>
    unwrap<{ messages: Record<string, unknown>[] }>(await runtime.handleMessage(message)).messages;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gg-orca-"));
    repo = path.join(dir, "repo");
    fs.mkdirSync(repo);
    git(repo, "init", "-q", "-b", "main");
    fs.writeFileSync(path.join(repo, "a.txt"), "first\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "first commit");
    firstHash = git(repo, "rev-parse", "HEAD");
    fs.writeFileSync(path.join(repo, "a.txt"), "first\nsecond\n");
    git(repo, "commit", "-q", "-am", "second commit");
    headHash = git(repo, "rev-parse", "HEAD");
    second = path.join(dir, "second-workspace");

    const fake = fakeOrca(repo, {}, [
      {
        id: "w3",
        kind: "worktree",
        name: "second",
        path: second,
        branch: "main",
        hostId: "local"
      }
    ]);
    posts = fake.posts;
    stored = fake.stored;
    vi.mocked(findWorkspacePathForTerminals).mockReset().mockResolvedValue(undefined);
    runtime = createRuntime(fake.orca);
    await runtime.init();
  });

  afterEach(() => {
    runtime.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("finds the repository of the local workspace and skips the one on another host", async () => {
    const answer = await runtime.handleRpc({ method: "repo.scan", params: null });

    expect(unwrap(answer)).toEqual({
      ok: true,
      result: { repos: [{ name: "repo", path: repo.replaceAll("\\", "/") }] }
    });
  });

  it("answers the webview's startup request", async () => {
    const answer = unwrap<{ ok: boolean; result: { config: { initialLoadCommits: number } } }>(
      await runtime.handleRpc({ method: "webview.initialize", params: null })
    );

    expect(answer.ok).toBe(true);
    expect(answer.result.config.initialLoadCommits).toBe(300);
  });

  it("reports an unknown RPC method instead of throwing", async () => {
    expect(unwrap(await runtime.handleRpc({ method: "no.such", params: null }))).toEqual({
      ok: false,
      error: "Unknown RPC method: no.such"
    });
  });

  it("lists branches and commits", async () => {
    const [branches] = await messages({
      command: "loadBranches",
      repo,
      showRemoteBranches: true,
      hard: false
    });
    expect(branches).toMatchObject({
      command: "loadBranches",
      branches: ["main"],
      head: "main",
      isRepo: true
    });

    const [commits] = await messages({
      command: "loadCommits",
      repo,
      branchName: "",
      maxCommits: 50,
      showRemoteBranches: true,
      hard: false
    });
    const nodes = commits?.["commits"] as GitCommitNode[];
    expect(nodes.map((node) => node.message)).toEqual(["second commit", "first commit"]);
    expect(nodes[0]?.hash).toBe(headHash);
  });

  it("remembers the repository it was pointed at", async () => {
    await messages({ command: "loadBranches", repo, showRemoteBranches: true, hard: false });

    await vi.waitFor(() => expect(stored.get("lastActiveRepo")).toBe(repo));
  });

  it("lists the files of a commit, even as the first message after the worker restarted", async () => {
    // Nothing has pointed the worker at the repository yet: the message has to name it.
    const [response] = await messages({ command: "commitDetails", repo, commitHash: headHash });

    const details = response?.["commitDetails"] as GitCommitDetails;
    expect(details.fileChanges).toEqual([
      { oldFilePath: "a.txt", newFilePath: "a.txt", type: "M", additions: 1, deletions: 0 }
    ]);
  });

  it("runs an action, and reports one that git refuses", async () => {
    await messages({ command: "selectRepo", repo });

    expect(
      await messages({
        command: "createBranch",
        repo,
        commitHash: firstHash,
        branchName: "feature"
      })
    ).toEqual([{ command: "createBranch", status: null }]);
    expect(git(repo, "branch", "--format=%(refname:short)").split("\n")).toContain("feature");

    const [refused] = await messages({
      command: "deleteBranch",
      repo,
      branchName: "does-not-exist",
      forceDelete: false
    });
    expect(refused?.["command"]).toBe("deleteBranch");
    expect(typeof refused?.["status"]).toBe("string");
  });

  describe("diffs", () => {
    const request = (overrides: Record<string, unknown>) => ({
      command: "viewDiff",
      repo,
      oldFilePath: "a.txt",
      newFilePath: "a.txt",
      type: "M",
      ...overrides
    });

    it("shows what a commit changed in a file", async () => {
      const output = unwrap<{ ok: true; diff: { title: string; patch: string } }>(
        await runtime.handleDiff(request({ commitHash: headHash }))
      );

      expect(output.ok).toBe(true);
      expect(output.diff.title).toBe(`a.txt (${headHash.slice(0, 8)}^ ↔ ${headHash.slice(0, 8)})`);
      expect(output.diff.patch).toContain("+second");
      expect(output.diff.patch).not.toContain("-first");
    });

    it("shows a file the first commit added, which has no parent", async () => {
      const output = unwrap<{ ok: true; diff: { title: string; patch: string } }>(
        await runtime.handleDiff(request({ commitHash: firstHash, type: "A" }))
      );

      expect(output.diff.title).toContain("Added in");
      expect(output.diff.patch).toContain("+first");
    });

    it("pairs the two sides of a rename", async () => {
      git(repo, "mv", "a.txt", "b.txt");
      git(repo, "commit", "-q", "-m", "rename");
      const hash = git(repo, "rev-parse", "HEAD");

      const output = unwrap<{ ok: true; diff: { patch: string } }>(
        await runtime.handleDiff(
          request({ commitHash: hash, oldFilePath: "a.txt", newFilePath: "b.txt", type: "R" })
        )
      );

      expect(output.diff.patch).toContain("rename from a.txt");
      expect(output.diff.patch).toContain("rename to b.txt");
    });

    it("fails softly for a commit that does not exist", async () => {
      expect(unwrap(await runtime.handleDiff(request({ commitHash: "0".repeat(40) })))).toEqual({
        ok: false
      });
    });

    it("rejects a request that is not a diff request", async () => {
      await expect(runtime.handleDiff({ command: "viewDiff" })).rejects.toThrow(
        /Invalid diff request/
      );
    });
  });

  it("tells the panel when a file of the open repository changes", async () => {
    await messages({ command: "loadBranches", repo, showRemoteBranches: true, hard: false });
    // Changes right after a request are its own doing and are ignored for a moment.
    await new Promise((resolve) => setTimeout(resolve, 1700));

    fs.writeFileSync(path.join(repo, "a.txt"), "changed outside the graph\n");

    await vi.waitFor(
      () =>
        expect(posts).toContainEqual({
          event: "gg.notify",
          payload: { name: "repo.updated", message: { path: repo } }
        }),
      { timeout: 6000, interval: 100 }
    );
  }, 15_000);

  it("tells the panel when a workspace with a repository appears or goes", async () => {
    await runtime.onWorkspaceCreated({ path: repo });
    await runtime.onWorkspaceCreated({ path: path.join(dir, "not-a-repo") });
    runtime.onWorkspaceRemoved({ path: repo });

    expect(posts.map((post) => post.payload)).toEqual([
      { name: "repo.changed", message: { type: "created", repo: { name: "repo", path: repo } } },
      { name: "repo.changed", message: { type: "deleted", path: repo } }
    ]);
  });

  describe("following the focused workspace", () => {
    it("sends the repository of the workspace Orca focuses, but not its terminal changes", async () => {
      // Orca reports the workspace already focused when the worker starts: a baseline, not a move.
      await runtime.onWorkspaceChanged(focusContext("w1", "repo"));
      expect(posts).toEqual([]);

      // The focused workspace's terminals opening, closing or renaming is the same workspace.
      await runtime.onWorkspaceChanged(focusContext("w1", "repo"));
      expect(posts).toEqual([]);

      await runtime.onWorkspaceChanged(focusContext("w3", "second"));
      expect(posts).toEqual([{ event: "gg.focusRepo", payload: { path: second } }]);
    });

    it("matches the workspace by name and branch when the ids differ", async () => {
      await runtime.onWorkspaceChanged(focusContext("w1", "repo"));
      await runtime.onWorkspaceChanged(focusContext("other-id", "second"));

      expect(posts).toEqual([{ event: "gg.focusRepo", payload: { path: second } }]);
    });

    it("does not guess between workspaces with the same name and branch", async () => {
      const ambiguous = fakeOrca(repo, {}, [
        {
          id: "w3",
          kind: "worktree",
          name: "team",
          path: path.join(dir, "team-a"),
          branch: "main",
          hostId: "local"
        },
        {
          id: "w4",
          kind: "worktree",
          name: "team",
          path: path.join(dir, "team-b"),
          branch: "main",
          hostId: "local"
        }
      ]);
      const other = createRuntime(ambiguous.orca);
      await other.init();

      await other.onWorkspaceChanged(focusContext("w1", "repo"));
      await other.onWorkspaceChanged(focusContext("other-id", "team"));

      expect(ambiguous.posts).toEqual([]);
      other.dispose();
    });

    it("finds the workspace by its terminals when name and branch collide", async () => {
      const ambiguous = fakeOrca(repo, {}, [
        {
          id: "w3",
          kind: "worktree",
          name: "team",
          path: path.join(dir, "team-a"),
          branch: "main",
          hostId: "local"
        },
        {
          id: "w4",
          kind: "worktree",
          name: "team",
          path: path.join(dir, "team-b"),
          branch: "main",
          hostId: "local"
        }
      ]);
      const other = createRuntime(ambiguous.orca);
      await other.init();
      vi.mocked(findWorkspacePathForTerminals).mockResolvedValue(path.join(dir, "team-b"));

      await other.onWorkspaceChanged(focusContext("w1", "repo"));
      await other.onWorkspaceChanged(focusContext("other-id", "team", [{ id: "term_x" }]));

      expect(ambiguous.posts).toEqual([
        { event: "gg.focusRepo", payload: { path: path.join(dir, "team-b") } }
      ]);
      expect(findWorkspacePathForTerminals).toHaveBeenCalledWith(["term_x"]);
      other.dispose();
    });

    describe("when Orca names the focused workspace by name and branch alone", () => {
      /** Two projects whose worktrees are both `team` on `main`; only the terminals tell them apart. */
      async function twoTeams() {
        const fake = fakeOrca(repo, {}, [
          {
            id: "w3",
            kind: "worktree",
            name: "team",
            path: path.join(dir, "team-a"),
            branch: "main",
            hostId: "local"
          },
          {
            id: "w4",
            kind: "worktree",
            name: "team",
            path: path.join(dir, "team-b"),
            branch: "main",
            hostId: "local"
          }
        ]);
        const other = createRuntime(fake.orca);
        await other.init();
        vi.mocked(findWorkspacePathForTerminals).mockImplementation(async (ids) =>
          ids.includes("term_a")
            ? path.join(dir, "team-a")
            : ids.includes("term_b")
              ? path.join(dir, "team-b")
              : undefined
        );
        return { other, posts: fake.posts };
      }

      it("follows a switch between two workspaces that share name and branch", async () => {
        const { other, posts: sent } = await twoTeams();

        // The workspace already focused when the worker starts is the baseline.
        await other.onWorkspaceChanged(idlessContext("team", [{ id: "term_a" }]));
        expect(sent).toEqual([]);

        // The other project's `team`/`main`: the same name and branch, different terminals.
        await other.onWorkspaceChanged(idlessContext("team", [{ id: "term_b" }]));
        expect(sent).toEqual([
          { event: "gg.focusRepo", payload: { path: path.join(dir, "team-b") } }
        ]);

        // And back again.
        await other.onWorkspaceChanged(idlessContext("team", [{ id: "term_a" }]));
        expect(sent.at(-1)).toEqual({
          event: "gg.focusRepo",
          payload: { path: path.join(dir, "team-a") }
        });
        expect(sent).toHaveLength(2);
        other.dispose();
      });

      it("does not move when only the focused workspace's terminals change", async () => {
        const { other, posts: sent } = await twoTeams();

        await other.onWorkspaceChanged(idlessContext("team", [{ id: "term_b" }]));
        await other.onWorkspaceChanged(idlessContext("team", [{ id: "term_b" }, { id: "term_b" }]));
        await other.onWorkspaceChanged(idlessContext("team", []));

        expect(sent).toEqual([]);
        other.dispose();
      });

      it("treats the first report as the baseline even when it could not be resolved", async () => {
        const { other, posts: sent } = await twoTeams();

        // No terminals: cannot tell which `team` this is, and that first report is consumed.
        await other.onWorkspaceChanged(idlessContext("team", []));
        await other.onWorkspaceChanged(idlessContext("team", [{ id: "term_b" }]));

        // The panel may not be on `team-b`, so this is a move worth reporting.
        expect(sent).toEqual([
          { event: "gg.focusRepo", payload: { path: path.join(dir, "team-b") } }
        ]);
        other.dispose();
      });

      it("drops a slow answer about a report that a newer one has replaced", async () => {
        const { other, posts: sent } = await twoTeams();
        vi.mocked(findWorkspacePathForTerminals).mockImplementation(async (ids) => {
          if (ids.includes("term_slow")) {
            await new Promise((resolve) => setTimeout(resolve, 40));
            return path.join(dir, "team-b");
          }
          return path.join(dir, "team-a");
        });

        await other.onWorkspaceChanged(idlessContext("team", [{ id: "term_a" }]));
        // The person clicks through to `team-b`, whose lookup is slow, and straight back to `team-a`.
        const slow = other.onWorkspaceChanged(idlessContext("team", [{ id: "term_slow" }]));
        await other.onWorkspaceChanged(idlessContext("team", [{ id: "term_a" }]));
        await slow;

        // Ending on `team-a`, the panel must not be sent to `team-b` by the late answer.
        expect(sent).toEqual([]);
        other.dispose();
      });

      it("keeps the last known workspace when focus passes to none", async () => {
        const { other, posts: sent } = await twoTeams();

        await other.onWorkspaceChanged(idlessContext("team", [{ id: "term_a" }]));
        await other.onWorkspaceChanged({ context: null });
        await other.onWorkspaceChanged(idlessContext("team", [{ id: "term_a" }]));

        expect(sent).toEqual([]);
        other.dispose();
      });
    });

    it("stays put for a workspace on another host, or none at all", async () => {
      await runtime.onWorkspaceChanged(focusContext("w1", "repo"));
      await runtime.onWorkspaceChanged(focusContext("w2", "far"));
      await runtime.onWorkspaceChanged({ context: null });

      expect(posts).toEqual([]);
    });
  });

  describe("giving a slow repository a commit-graph", () => {
    const loadCommitsMessage = () => ({
      command: "loadCommits",
      repo,
      branchName: "",
      maxCommits: 50,
      showRemoteBranches: true,
      hard: false
    });

    it("offers the repository to the writer after a load of commits, and after nothing else", async () => {
      const consider = vi.fn().mockResolvedValue("fast");
      const other = createRuntime(fakeOrca(repo).orca, { commitGraph: { consider } });
      await other.init();

      await other.handleMessage({
        command: "loadBranches",
        repo,
        showRemoteBranches: true,
        hard: false
      });
      await other.handleMessage({ command: "commitDetails", repo, commitHash: headHash });
      expect(consider).not.toHaveBeenCalled();

      await other.handleMessage(loadCommitsMessage());

      expect(consider).toHaveBeenCalledTimes(1);
      expect(consider).toHaveBeenCalledWith(repo, expect.any(Number));
      other.dispose();
    });

    it("never lets the writer get in the way of the answer", async () => {
      const consider = vi.fn().mockRejectedValue(new Error("disk full"));
      const other = createRuntime(fakeOrca(repo).orca, { commitGraph: { consider } });
      await other.init();

      const answer = await other.handleMessage(loadCommitsMessage());

      expect(unwrap<{ messages: { command: string }[] }>(answer).messages[0]?.command).toBe(
        "loadCommits"
      );
      other.dispose();
    });
  });

  it("rejects a message that is not a command", async () => {
    await expect(runtime.handleMessage({ nope: 1 })).rejects.toThrow(/Invalid message/);
    await expect(runtime.handleMessage("hi")).rejects.toThrow(/Invalid message/);
  });

  it("hands out a large answer in parts that add up to it", async () => {
    // Enough commits that the answer exceeds what Orca lets one answer carry.
    const lines: string[] = [];
    for (let index = 0; index < 700; index++) {
      lines.push(
        `commit refs/heads/main\nmark :${index + 1}\ncommitter T <t@e.c> ${1_700_000_000 + index} +0000\ndata ${("m" + index + " " + "x".repeat(1500)).length}\n${"m" + index + " " + "x".repeat(1500)}\n${index === 0 ? "" : `from :${index}\n`}`
      );
    }
    execFileSync("git", ["fast-import", "--quiet", "--force"], {
      cwd: repo,
      input: lines.join("\n"),
      env: { ...process.env, ...IDENTITY }
    });

    const answer = await runtime.handleMessage({
      command: "loadCommits",
      repo,
      branchName: "",
      maxCommits: 700,
      showRemoteBranches: false,
      hard: false
    });

    expect(answer).toHaveProperty("chunked");
    const { id, parts } = (answer as { chunked: { id: string; parts: number } }).chunked;
    expect(parts).toBeGreaterThan(1);
    const json = Array.from(
      { length: parts },
      (_, part) => runtime.handleFetch({ id, part }).chunk
    ).join("");
    const response = (JSON.parse(json) as { messages: { commits: GitCommitNode[] }[] }).messages[0];
    // The import moved HEAD under the working tree, so the graph also has its uncommitted row ("*").
    expect(response?.commits.filter((commit) => commit.hash !== "*")).toHaveLength(700);
    expect(() => runtime.handleFetch({ id, part: 0 })).toThrow(/expired/);
  }, 30_000);
});
