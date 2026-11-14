import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * A load that took this long marks a repository as one a commit-graph helps. Without the file,
 * `git log --date-order` has to walk the whole history before it can show the first commit: about
 * 1.3 s on a 170,000-commit repository (0.02 s with the file) and 0.2 s on a 13,000-commit one. Small
 * repositories answer in well under this and are left alone.
 */
export const SLOW_LOG_MS = 200;

/** After a failed attempt, leave the repository alone for this long. */
export const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

const WRITE_TIMEOUT_MS = 10 * 60 * 1000;

export type CommitGraphOutcome =
  /** The setting is off. */
  | "disabled"
  /** The log was quick; this repository does not need it. */
  | "fast"
  /** Looked at already in this run, or being looked at now. */
  | "checked"
  /** The repository has one, or has been given one. */
  | "present"
  /** A write failed lately; not trying again yet. */
  | "backoff"
  | "written"
  | "failed";

export type CommitGraphDeps = {
  /** Runs git in `repo` and resolves to its output. */
  git: (repo: string, args: readonly string[]) => Promise<string>;
  exists: (file: string) => boolean;
  now: () => number;
  /** Failed attempts from earlier runs: repository path to the time of the failure. */
  loadFailures: () => Promise<Readonly<Record<string, number>>>;
  saveFailure: (repo: string, at: number) => Promise<void>;
  log: (message: string) => void;
};

/** git in `repo`, as the worker runs it everywhere: no prompts, no optional locks. */
export function gitRunner(gitPath: () => string): CommitGraphDeps["git"] {
  return async (repo, args) => {
    const { stdout } = await execFileAsync(gitPath(), ["--no-optional-locks", ...args], {
      cwd: repo,
      timeout: WRITE_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
    });
    return stdout;
  };
}

/**
 * Gives a slow repository a commit-graph file: a cache git keeps of how commits connect, which it
 * reads on its own when it exists. It is one file under `.git/objects/info`, which `git gc` writes
 * too, and is safe to delete. It is written once, in the background, after a log that was slow.
 */
export function createCommitGraphWriter(deps: CommitGraphDeps, enabled: () => boolean) {
  /** Repositories looked at in this run, marked before the first question so two logs cannot both write. */
  const looked = new Set<string>();

  /** Where git keeps the file (it can be a chain of files), which for a worktree is the main repo. */
  async function hasCommitGraph(repo: string): Promise<boolean> {
    for (const name of [
      "objects/info/commit-graph",
      "objects/info/commit-graphs/commit-graph-chain"
    ]) {
      // eslint-disable-next-line no-await-in-loop -- two cheap questions, asked in turn
      const where = (await deps.git(repo, ["rev-parse", "--git-path", name])).trim();
      if (where !== "" && deps.exists(path.resolve(repo, where))) {
        return true;
      }
    }
    return false;
  }

  return {
    /** Call after each log with how long it took. Cheap unless the log was slow. */
    async consider(repo: string, logMs: number): Promise<CommitGraphOutcome> {
      if (!enabled()) {
        return "disabled";
      }
      if (logMs < SLOW_LOG_MS) {
        return "fast";
      }
      if (looked.has(repo)) {
        return "checked";
      }
      looked.add(repo);

      const failedAt = (await deps.loadFailures())[repo];
      if (failedAt !== undefined && deps.now() - failedAt < RETRY_AFTER_MS) {
        return "backoff";
      }

      try {
        if (await hasCommitGraph(repo)) {
          return "present";
        }
        deps.log(`Writing a commit-graph for ${repo}: its log took ${Math.round(logMs)} ms.`);
        await deps.git(repo, ["commit-graph", "write", "--reachable", "--split", "--no-progress"]);
        return "written";
      } catch (error) {
        deps.log(
          `Could not write a commit-graph for ${repo}: ${error instanceof Error ? error.message : String(error)}`
        );
        await deps.saveFailure(repo, deps.now()).catch(() => undefined);
        return "failed";
      }
    }
  };
}

export type CommitGraphWriter = ReturnType<typeof createCommitGraphWriter>;

/** Whether a file exists, for `CommitGraphDeps`. */
export const fileExists = (file: string): boolean => fs.existsSync(file);
