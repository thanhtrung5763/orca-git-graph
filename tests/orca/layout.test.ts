import { describe, expect, it } from "vitest";

import { computeGraphLayout } from "@/webview/graph/layout";

import { fingerprint, layoutCases, randomHistory } from "./helpers/histories";

/**
 * What `computeGraphLayout` drew for each history in `layoutCases()` when these were recorded, as a
 * fingerprint of the whole layout (every line and vertex). They pin the algorithm: a faster version
 * has to draw exactly the same graph. They were recorded from the original implementation, before
 * its search for the next branch to walk resumed where it stopped instead of starting over.
 */
const GOLDEN: Record<string, string> = {
  small: "1722079c724570b4",
  linear: "c7eb8f379508702a",
  everyday: "ae74ab614bd0e061",
  mergey: "f7853fddc0b26dcd",
  branchy: "a8349f05be74c0db",
  uncommitted: "bc368de785eea69c",
  octopus: "c05f5c9e0a34a68d",
  dense: "a28a48d41c6fa3bf",
  truncated: "978a994f991c781f",
  headMissing: "87ec43cfb25bd68d"
};

describe("computeGraphLayout", () => {
  const cases = layoutCases();

  it("has a golden for every case, and no case is missing one", () => {
    expect(Object.keys(GOLDEN).toSorted()).toEqual(Object.keys(cases).toSorted());
  });

  it.each(Object.keys(GOLDEN))(
    "draws the %s history exactly as the original algorithm did",
    (name) => {
      const { commits, head } = cases[name] ?? { commits: [], head: null };

      expect(fingerprint(computeGraphLayout(commits, head))).toBe(GOLDEN[name]);
    }
  );

  it("is the same on every run", () => {
    const { commits, head } = cases["mergey"] ?? { commits: [], head: null };

    expect(fingerprint(computeGraphLayout(commits, head))).toBe(
      fingerprint(computeGraphLayout(commits, head))
    );
  });

  it("gives every commit a vertex, in the order of the commits", () => {
    const commits = randomHistory({ seed: 11, commits: 500, mergeRate: 0.25, branchRate: 0.25 });

    const layout = computeGraphLayout(commits, "c0");

    expect(layout.vertices).toHaveLength(commits.length);
    expect(layout.vertices.map((vertex) => vertex.y)).toEqual(commits.map((_, row) => row));
  });

  it("draws nothing for no commits", () => {
    const layout = computeGraphLayout([], null);

    expect(layout.vertices).toEqual([]);
    expect(layout.branches).toEqual([]);
  });

  it("stays fast on a long, branchy history", () => {
    // 20,000 commits drew in ~100 ms; the search that started over for every branch made the cost grow
    // with commits times branches. The bound is loose: it only has to tell that growth from a slow machine.
    const { commits, head } = {
      commits: randomHistory({ seed: 12, commits: 20_000, mergeRate: 0.15, branchRate: 0.3 }),
      head: "c0"
    };

    const started = performance.now();
    computeGraphLayout(commits, head);

    expect(performance.now() - started).toBeLessThan(2000);
  });
});
