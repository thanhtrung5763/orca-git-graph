import { createHash } from "node:crypto";

import type { GitCommitNode } from "@/backend/types";

export type HistoryShape = {
  seed: number;
  commits: number;
  /** Chance that a commit is a merge: it gets a second parent further down. */
  mergeRate: number;
  /** Chance that a commit's first parent is not the next commit, which starts a side branch. */
  branchRate: number;
  /** Chance that a merge is an octopus, with a third parent. */
  octopusRate?: number;
  /** Put the row of uncommitted changes first, as the graph does when HEAD has changes. */
  uncommitted?: boolean;
};

/** A small, fast, seeded generator, so a history is the same on every machine and every run. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A history in the order `git log --date-order` gives: every commit comes before its parents. Commit
 * `i` has its parents among the commits after it, so the graph is acyclic by construction.
 */
export function randomHistory(shape: HistoryShape): GitCommitNode[] {
  const random = mulberry32(shape.seed);
  const { commits: count, mergeRate, branchRate, octopusRate = 0 } = shape;
  const below = (index: number, reach: number) =>
    Math.min(index + 1 + Math.floor(random() * reach), count - 1);

  const nodes: GitCommitNode[] = [];
  for (let index = 0; index < count; index++) {
    const parents: number[] = [];
    if (index < count - 1) {
      parents.push(random() < branchRate ? below(index, 12) : index + 1);
      if (random() < mergeRate) {
        const second = below(index, 40);
        if (!parents.includes(second)) {
          parents.push(second);
        }
        if (random() < octopusRate) {
          const third = below(index, 60);
          if (!parents.includes(third)) {
            parents.push(third);
          }
        }
      }
    }
    nodes.push({
      hash: `c${index}`,
      parentHashes: parents.map((parent) => `c${parent}`),
      author: "A",
      email: "a@example.com",
      date: 1_700_000_000 - index * 60,
      message: `commit ${index}`,
      refs: []
    });
  }

  if (shape.uncommitted === true) {
    nodes.unshift({
      hash: "*",
      parentHashes: ["c0"],
      author: "*",
      email: "",
      date: 1_700_000_100,
      message: "",
      refs: []
    });
  }
  return nodes;
}

/** A short fingerprint of a value, for comparing two layouts without keeping either. */
export function fingerprint(value: unknown): string {
  return createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

/** The histories whose layout is pinned by `tests/orca/layout.test.ts`, with the HEAD each is drawn for. */
export function layoutCases(): Record<string, { commits: GitCommitNode[]; head: string | null }> {
  const shapes: Record<string, HistoryShape> = {
    small: { seed: 5, commits: 50, mergeRate: 0.2, branchRate: 0.2 },
    linear: { seed: 6, commits: 800, mergeRate: 0, branchRate: 0 },
    everyday: { seed: 1, commits: 300, mergeRate: 0.15, branchRate: 0.1 },
    mergey: { seed: 2, commits: 2000, mergeRate: 0.2, branchRate: 0.15 },
    branchy: { seed: 3, commits: 5000, mergeRate: 0.1, branchRate: 0.3 },
    uncommitted: { seed: 4, commits: 1500, mergeRate: 0.3, branchRate: 0.3, uncommitted: true },
    octopus: { seed: 7, commits: 1200, mergeRate: 0.4, branchRate: 0.2, octopusRate: 0.5 },
    dense: {
      seed: 8,
      commits: 3000,
      mergeRate: 0.5,
      branchRate: 0.5,
      octopusRate: 0.3,
      uncommitted: true
    }
  };

  const cases: Record<string, { commits: GitCommitNode[]; head: string | null }> = {};
  for (const [name, shape] of Object.entries(shapes)) {
    cases[name] = { commits: randomHistory(shape), head: shape.uncommitted === true ? null : "c0" };
  }

  // Only the first commits of a long history are loaded, so many parents are not in the list.
  cases["truncated"] = {
    commits: randomHistory({ seed: 9, commits: 1000, mergeRate: 0.3, branchRate: 0.3 }).slice(
      0,
      400
    ),
    head: "c0"
  };
  // HEAD is not among the loaded commits (a branch is shown that does not contain it).
  cases["headMissing"] = {
    commits: randomHistory({ seed: 10, commits: 600, mergeRate: 0.2, branchRate: 0.2 }),
    head: "elsewhere"
  };
  return cases;
}
