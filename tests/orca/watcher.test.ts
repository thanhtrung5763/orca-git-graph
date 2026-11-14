import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { createRepoWatcher, isRelevantChange, type WatchFn } from "@/orca/worker/watcher";

describe("isRelevantChange", () => {
  it.each([
    ["src/main.ts", true],
    ["README.md", true],
    [".git/HEAD", true],
    [".git/index", true],
    [".git/packed-refs", true],
    [".git/refs/heads/main", true],
    [".git/objects/ab/cdef", false],
    [".git/logs/HEAD", false],
    [".git/index.lock", false],
    ["node_modules/pkg/index.js", false],
    ["packages/app/node_modules/pkg/index.js", false],
    ["../outside.txt", false],
    ["", false]
  ])("%s -> %s", (relativePath, expected) => {
    expect(isRelevantChange(relativePath)).toBe(expected);
  });
});

describe("createRepoWatcher", () => {
  type Opened = {
    dir: string;
    recursive: boolean;
    listener: (p: string | null) => void;
    close: Mock<() => void>;
  };
  let opened: Opened[];
  let watch: WatchFn;
  let now: number;
  const onUpdate = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    opened = [];
    now = 10_000;
    onUpdate.mockReset();
    watch = (dir, options, listener) => {
      const entry: Opened = {
        dir,
        recursive: options.recursive,
        listener,
        close: vi.fn<() => void>()
      };
      opened.push(entry);
      return { close: entry.close };
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function create(linked?: { gitDir: string; commonDir: string }) {
    return createRepoWatcher({
      onUpdate,
      watch,
      now: () => now,
      resolveGitDirs: async () => (linked ? { linked: true, ...linked } : { linked: false })
    });
  }

  it("watches the repository folder recursively", async () => {
    const watcher = create();
    watcher.select("/repo");
    await vi.advanceTimersByTimeAsync(0);

    expect(opened.map((entry) => [entry.dir, entry.recursive])).toEqual([["/repo", true]]);
  });

  it("reports one update for a burst of changes", async () => {
    const watcher = create();
    watcher.select("/repo");
    await vi.advanceTimersByTimeAsync(0);

    opened[0]?.listener("a.txt");
    opened[0]?.listener("b.txt");
    opened[0]?.listener(".git/index");
    await vi.advanceTimersByTimeAsync(249);
    expect(onUpdate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith("/repo");
  });

  it("ignores changes that cannot alter the graph", async () => {
    const watcher = create();
    watcher.select("/repo");
    await vi.advanceTimersByTimeAsync(0);

    opened[0]?.listener(".git/objects/ab/cd");
    opened[0]?.listener("node_modules/x/y.js");
    await vi.advanceTimersByTimeAsync(1000);

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("treats a change with an unknown name as relevant", async () => {
    const watcher = create();
    watcher.select("/repo");
    await vi.advanceTimersByTimeAsync(0);

    opened[0]?.listener(null);
    await vi.advanceTimersByTimeAsync(300);

    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("ignores changes while a request runs and for a moment after", async () => {
    const watcher = create();
    watcher.select("/repo");
    await vi.advanceTimersByTimeAsync(0);

    watcher.mute();
    watcher.mute();
    opened[0]?.listener("a.txt");
    watcher.unmute();
    opened[0]?.listener("a.txt"); // still one request running
    watcher.unmute();
    opened[0]?.listener("a.txt"); // just after the last one
    now += 1000;
    opened[0]?.listener("a.txt");
    await vi.advanceTimersByTimeAsync(1000);
    expect(onUpdate).not.toHaveBeenCalled();

    now += 600; // past the resume delay
    opened[0]?.listener("a.txt");
    await vi.advanceTimersByTimeAsync(300);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("ignores an unmute that has no mute", async () => {
    const watcher = create();
    watcher.unmute();
    watcher.select("/repo");
    await vi.advanceTimersByTimeAsync(0);

    opened[0]?.listener("a.txt");
    await vi.advanceTimersByTimeAsync(300);

    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("moves to another repository, closing the first watch", async () => {
    const watcher = create();
    watcher.select("/one");
    await vi.advanceTimersByTimeAsync(0);
    watcher.select("/two");
    await vi.advanceTimersByTimeAsync(0);

    expect(opened[0]?.close).toHaveBeenCalledTimes(1);
    expect(opened.map((entry) => entry.dir)).toEqual(["/one", "/two"]);
  });

  it("keeps the watch when the same repository is selected again", async () => {
    const watcher = create();
    watcher.select("/repo");
    await vi.advanceTimersByTimeAsync(0);
    watcher.select("/repo");
    await vi.advanceTimersByTimeAsync(0);

    expect(opened).toHaveLength(1);
    expect(opened[0]?.close).not.toHaveBeenCalled();
  });

  it("does not open a watch for a repository that was replaced before it resolved", async () => {
    const watcher = create();
    watcher.select("/one");
    watcher.select("/two");
    await vi.advanceTimersByTimeAsync(0);

    expect(opened.map((entry) => entry.dir)).toEqual(["/two"]);
  });

  it("also watches the Git directories of a linked worktree", async () => {
    const gitDir = "/main/.git/worktrees/wt";
    const commonDir = "/main/.git";
    const watcher = create({ gitDir, commonDir });
    watcher.select("/wt");
    await vi.advanceTimersByTimeAsync(0);

    expect(opened.map((entry) => [entry.dir, entry.recursive])).toEqual([
      ["/wt", true],
      [gitDir, false],
      [commonDir, false],
      [path.join(commonDir, "refs"), true]
    ]);

    // A branch moved in the main repository's refs.
    opened[3]?.listener(path.join("heads", "feature"));
    await vi.advanceTimersByTimeAsync(300);
    expect(onUpdate).toHaveBeenCalledTimes(1);

    // Noise in the main repository's .git does not count.
    opened[2]?.listener("objects");
    await vi.advanceTimersByTimeAsync(300);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("survives a watch that cannot be opened", async () => {
    const onError = vi.fn();
    const watcher = createRepoWatcher({
      onUpdate,
      onError,
      watch: () => {
        throw new Error("ENOSPC");
      },
      resolveGitDirs: async () => ({ linked: false })
    });

    watcher.select("/repo");
    await vi.advanceTimersByTimeAsync(0);

    expect(onError).toHaveBeenCalledWith(expect.stringContaining("ENOSPC"));
  });

  it("closes everything and drops a pending update when disposed", async () => {
    const watcher = create();
    watcher.select("/repo");
    await vi.advanceTimersByTimeAsync(0);
    opened[0]?.listener("a.txt");

    watcher.dispose();
    await vi.advanceTimersByTimeAsync(1000);

    expect(opened[0]?.close).toHaveBeenCalledTimes(1);
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
