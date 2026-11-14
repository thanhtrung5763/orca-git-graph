import { describe, expect, it } from "vitest";

import { adjacentCommit } from "@/orca/panel/commitNavigation";

const UNCOMMITTED = "*";
const hashes = [UNCOMMITTED, "a", "b", "c"];

describe("adjacentCommit", () => {
  it("moves to the next commit down and the previous one up", () => {
    expect(adjacentCommit(hashes, "b", "down", UNCOMMITTED)).toBe("c");
    expect(adjacentCommit(hashes, "b", "up", UNCOMMITTED)).toBe("a");
  });

  it("stops at the ends of the list", () => {
    expect(adjacentCommit(hashes, "c", "down", UNCOMMITTED)).toBeUndefined();
    expect(adjacentCommit(hashes, "a", "up", UNCOMMITTED)).toBeUndefined();
  });

  it("never lands on the uncommitted changes row, which cannot be opened", () => {
    expect(adjacentCommit(hashes, "a", "up", UNCOMMITTED)).toBeUndefined();
    expect(adjacentCommit(hashes, null, "down", UNCOMMITTED)).toBe("a");
  });

  it("opens the first commit on Down when nothing is open, and leaves Up to scroll", () => {
    expect(adjacentCommit(hashes, null, "down", UNCOMMITTED)).toBe("a");
    expect(adjacentCommit(hashes, null, "up", UNCOMMITTED)).toBeUndefined();
  });

  it("treats a commit that is no longer in the list as nothing open", () => {
    expect(adjacentCommit(hashes, "gone", "down", UNCOMMITTED)).toBe("a");
    expect(adjacentCommit(hashes, "gone", "up", UNCOMMITTED)).toBeUndefined();
  });

  it("copes with an empty list", () => {
    expect(adjacentCommit([], null, "down", UNCOMMITTED)).toBeUndefined();
    expect(adjacentCommit([UNCOMMITTED], null, "down", UNCOMMITTED)).toBeUndefined();
  });
});
