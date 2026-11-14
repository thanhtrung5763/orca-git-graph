import { describe, expect, it } from "vitest";

import { findMatches, type FindOptions } from "@/orca/panel/find/findMatches";

const words: FindOptions = { caseSensitive: false, regex: false };
const exact: FindOptions = { caseSensitive: true, regex: false };
const regex: FindOptions = { caseSensitive: false, regex: true };

// message, hash, author, email, refs, date: what a row is recognised by.
const entries: string[][] = [
  [], // the uncommitted changes row
  [
    "fix(queue): default queue_max_size 10",
    "5c69b564aa11",
    "Alice Nguyen",
    "alice@example.com",
    "main",
    "Nov 13, 2026 16:28"
  ],
  [
    "feat: add Kafka outbox",
    "fd983baf0e22",
    "Bob Tran",
    "bob@example.com",
    "origin/dev",
    "Nov 12, 2026 09:01"
  ],
  [
    "Merge pull request #31 from team/login-flow",
    "3d925023bb33",
    "Alice Nguyen",
    "alice@example.com",
    "v2.0",
    "Oct 30, 2026 18:45"
  ]
];

const find = (query: string, options: FindOptions = words) =>
  findMatches(entries, query, options).indices;

describe("findMatches", () => {
  it("finds a word in the description, whatever its case", () => {
    expect(find("kafka")).toEqual([2]);
    expect(find("QUEUE")).toEqual([1]);
  });

  it("finds a commit by its hash, or by the start of it", () => {
    expect(find("fd983baf0e22")).toEqual([2]);
    expect(find("3d9250")).toEqual([3]);
  });

  it("finds commits by author, by email, by branch or tag name and by date", () => {
    expect(find("alice")).toEqual([1, 3]);
    expect(find("bob@example")).toEqual([2]);
    expect(find("origin/dev")).toEqual([2]);
    expect(find("v2.0")).toEqual([3]);
    expect(find("Oct 30")).toEqual([3]);
    expect(find("2026")).toEqual([1, 2, 3]);
  });

  it("matches the query as one piece of text, with its spaces", () => {
    expect(find("pull request")).toEqual([3]);
    expect(find("request pull")).toEqual([]);
    expect(find("Alice Nguyen")).toEqual([1, 3]);
  });

  it("does not match words one by one across the texts of a commit", () => {
    // Both words are in commit 3, but in two texts (the author and the description).
    expect(find("alice login")).toEqual([]);
    // A lone digit is in nearly every date and hash; it only matches where it really is.
    expect(find("3 ")).toEqual(find("3"));
    expect(find("kafka 3")).toEqual([]);
  });

  it("does not let the query match across two texts", () => {
    // "main" ends the refs of #1 and "Nov" starts its date; "mainnov" is in neither.
    expect(find("mainnov")).toEqual([]);
    expect(find("main\nNov")).toEqual([]);
  });

  it("ignores spaces around the query", () => {
    expect(find("  kafka  ")).toEqual([2]);
  });

  it("takes characters that mean something in a regular expression literally", () => {
    expect(find("fix(queue):")).toEqual([1]);
    expect(find("#31")).toEqual([3]);
    expect(find("a.b")).toEqual([]);
  });

  it("never matches the uncommitted changes row", () => {
    expect(find(" ")).toEqual([]);
    expect(findMatches(entries, ".", regex).indices).not.toContain(0);
  });

  it("finds nothing for an empty query", () => {
    expect(findMatches(entries, "", words)).toEqual({ indices: [], invalid: false });
    expect(findMatches(entries, "   ", words)).toEqual({ indices: [], invalid: false });
  });

  it("can match case", () => {
    expect(find("kafka", exact)).toEqual([]);
    expect(find("Kafka", exact)).toEqual([2]);
  });

  describe("as a regular expression", () => {
    it("matches one text on its own", () => {
      expect(find("^fix", regex)).toEqual([1]);
      expect(find("number|outbox", regex)).toEqual([2]);
      expect(find("#\\d+", regex)).toEqual([3]);
    });

    it("can match case", () => {
      expect(find("^FIX", regex)).toEqual([1]);
      expect(find("^FIX", { caseSensitive: true, regex: true })).toEqual([]);
    });

    it("reports an expression that does not parse", () => {
      expect(findMatches(entries, "(", regex)).toEqual({ indices: [], invalid: true });
      expect(findMatches(entries, "[a-", regex)).toEqual({ indices: [], invalid: true });
    });

    it("does not call a plain word invalid: there it is just a character", () => {
      // The "(" of "fix(queue)".
      expect(findMatches(entries, "(", words)).toEqual({ indices: [1], invalid: false });
    });
  });
});
