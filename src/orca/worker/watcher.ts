import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

/** Wait this long after the last change before telling the panel. */
const REFRESH_DELAY_MS = 250;
/** Ignore changes this long after the last request: they are the request's own doing. */
const RESUME_DELAY_MS = 1500;
/** What in `.git` changes the graph: HEAD, the index (uncommitted changes) and the refs. */
const GIT_DATA = /^(HEAD|config|index|packed-refs|refs(?:\/.*)?)$/;

type GitDirs = { linked: false } | { linked: true; gitDir: string; commonDir: string };

type Target = {
  dir: string;
  recursive: boolean;
  /** Path of `dir` inside the Git directory, so its events read like `.git` ones. */
  gitPrefix: string | null;
};

export type WatchHandle = { close(): void };
export type WatchFn = (
  target: string,
  options: { recursive: boolean },
  listener: (relativePath: string | null) => void
) => WatchHandle;

export type RepoWatcherOptions = {
  /** A change that affects the graph of `repo`, debounced. */
  onUpdate: (repo: string) => void;
  onError?: (message: string) => void;
  delayMs?: number;
  resumeMs?: number;
  now?: () => number;
  watch?: WatchFn;
  resolveGitDirs?: (repo: string) => Promise<GitDirs>;
};

/**
 * Whether a change to `relativePath` (relative to the repository root) can change the graph.
 * Inside `.git` only the data that makes the graph counts; `node_modules` is never worth a refresh.
 */
export function isRelevantChange(relativePath: string): boolean {
  const normalised = relativePath.split(path.sep).join("/");
  if (normalised === "" || normalised.startsWith("../")) {
    return false;
  }
  if (normalised.startsWith(".git/")) {
    return GIT_DATA.test(normalised.slice(".git/".length));
  }
  return !normalised.split("/").includes("node_modules");
}

const defaultWatch: WatchFn = (target, options, listener) => {
  const watcher = fs.watch(target, { recursive: options.recursive }, (_event, filename) =>
    listener(filename === null ? null : String(filename))
  );
  // A watcher error (a deleted directory, a watch limit) must not take the worker down.
  watcher.on("error", () => watcher.close());
  return watcher;
};

/**
 * A linked worktree's `.git` is a file that points at `<main>/.git/worktrees/<name>`, and its
 * branches live in the main repository's `refs`; watching the worktree folder alone misses them.
 */
export async function resolveGitDirs(repo: string): Promise<GitDirs> {
  const dotGit = path.join(repo, ".git");
  const stat = await fsp.stat(dotGit).catch(() => null);
  if (stat === null || stat.isDirectory()) {
    return { linked: false };
  }

  const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(await fsp.readFile(dotGit, "utf8").catch(() => ""));
  if (pointer?.[1] === undefined) {
    return { linked: false };
  }
  const gitDir = path.resolve(repo, pointer[1]);
  const common = await fsp
    .readFile(path.join(gitDir, "commondir"), "utf8")
    .then((text) => text.trim())
    .catch(() => null);
  return {
    linked: true,
    gitDir,
    commonDir: common === null || common === "" ? gitDir : path.resolve(gitDir, common)
  };
}

/**
 * Watches one repository, the one open in the panel, and calls `onUpdate` when its files or refs
 * change. Port of neo-git-graph's `watchers/git-repo.watcher.ts` onto `fs.watch`.
 */
export function createRepoWatcher(options: RepoWatcherOptions) {
  const delayMs = options.delayMs ?? REFRESH_DELAY_MS;
  const resumeMs = options.resumeMs ?? RESUME_DELAY_MS;
  const now = options.now ?? Date.now;
  const watch = options.watch ?? defaultWatch;
  const resolve = options.resolveGitDirs ?? resolveGitDirs;

  let repoPath: string | undefined;
  let handles: WatchHandle[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let muteDepth = 0;
  let resumeAt = 0;

  function stop(): void {
    generation++;
    for (const handle of handles) {
      handle.close();
    }
    handles = [];
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  function changed(repo: string, target: Target, relativePath: string | null): void {
    if (muteDepth > 0 || now() < resumeAt) {
      return;
    }
    if (relativePath !== null) {
      const inRepo =
        target.gitPrefix === null
          ? relativePath
          : path.posix.join(".git", target.gitPrefix, relativePath.split(path.sep).join("/"));
      if (!isRelevantChange(inRepo)) {
        return;
      }
    }

    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      options.onUpdate(repo);
    }, delayMs);
  }

  function open(repo: string, target: Target): void {
    try {
      handles.push(
        watch(target.dir, { recursive: target.recursive }, (relativePath) =>
          changed(repo, target, relativePath)
        )
      );
    } catch (error) {
      options.onError?.(
        `Cannot watch ${target.dir}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return {
    /** Watch `repo` (and stop watching the previous one). */
    select(repo: string): void {
      if (repo === repoPath && handles.length > 0) {
        return;
      }

      stop();
      repoPath = repo;
      const mine = generation;
      void resolve(repo).then((dirs) => {
        if (mine !== generation) {
          return;
        }
        open(repo, { dir: repo, recursive: true, gitPrefix: null });
        if (dirs.linked) {
          open(repo, { dir: dirs.gitDir, recursive: false, gitPrefix: "" });
          open(repo, { dir: dirs.commonDir, recursive: false, gitPrefix: "" });
          open(repo, {
            dir: path.join(dirs.commonDir, "refs"),
            recursive: true,
            gitPrefix: "refs"
          });
        }
      });
    },

    /** A request is running: its own file changes are not news. Pair with `unmute`. */
    mute(): void {
      muteDepth++;
    },

    unmute(): void {
      if (muteDepth === 0) {
        return;
      }
      muteDepth--;
      if (muteDepth === 0) {
        resumeAt = now() + resumeMs;
      }
    },

    dispose(): void {
      repoPath = undefined;
      muteDepth = 0;
      resumeAt = 0;
      stop();
    }
  };
}

export type RepoWatcher = ReturnType<typeof createRepoWatcher>;
