import type { GitRepoSet, GitRepoState } from "@/types";

type Storage = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<unknown>;
};

const LAST_ACTIVE_REPO = "lastActiveRepo";
const REPO_STATES = "repoStates";
const COMMIT_GRAPH_FAILURES = "commitGraphFailures";

/** What the plugin keeps between runs, in Orca's per-plugin storage (`storage:own`). */
export function createStateStore(storage: Storage) {
  return {
    async getLastActiveRepo(): Promise<string | null> {
      const value = await storage.get(LAST_ACTIVE_REPO);
      return typeof value === "string" ? value : null;
    },

    async setLastActiveRepo(repo: string): Promise<void> {
      await storage.set(LAST_ACTIVE_REPO, repo);
    },

    /** Repositories a commit-graph could not be written for: path to the time it failed. */
    async getCommitGraphFailures(): Promise<Record<string, number>> {
      const stored = await storage.get(COMMIT_GRAPH_FAILURES);
      return typeof stored === "object" && stored !== null && !Array.isArray(stored)
        ? (stored as Record<string, number>)
        : {};
    },

    async setCommitGraphFailure(repo: string, at: number): Promise<void> {
      const failures = await this.getCommitGraphFailures();
      await storage.set(COMMIT_GRAPH_FAILURES, { ...failures, [repo]: at });
    },

    async setRepoState(repo: string, state: GitRepoState): Promise<void> {
      const stored = await storage.get(REPO_STATES);
      const states: GitRepoSet =
        typeof stored === "object" && stored !== null && !Array.isArray(stored)
          ? (stored as GitRepoSet)
          : {};
      await storage.set(REPO_STATES, { ...states, [repo]: state });
    }
  };
}

export type StateStore = ReturnType<typeof createStateStore>;
