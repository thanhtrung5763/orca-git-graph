import { describe, expect, it } from "vitest";

import { parsePatch, toSideBySide } from "@/orca/panel/diff/parsePatch";

const PATCH = [
  "diff --git a/old.txt b/new.txt",
  "similarity index 80%",
  "rename from old.txt",
  "rename to new.txt",
  "index 83db48f..bf2a1d3 100644",
  "--- a/old.txt",
  "+++ b/new.txt",
  "@@ -1,4 +1,4 @@ function context",
  " keep",
  "-removed one",
  "-removed two",
  "+added one",
  " keep too",
  "@@ -20 +20,2 @@",
  "-tail",
  "\\ No newline at end of file",
  "+tail",
  "+more",
  ""
].join("\n");

describe("parsePatch", () => {
  it("keeps the extended headers that say something and skips the ones that repeat the path", () => {
    expect(parsePatch(PATCH).meta).toEqual([
      "similarity index 80%",
      "rename from old.txt",
      "rename to new.txt"
    ]);
  });

  it("numbers lines from the hunk headers", () => {
    const { hunks } = parsePatch(PATCH);

    expect(hunks).toHaveLength(2);
    expect(hunks[0]?.header).toBe("@@ -1,4 +1,4 @@ function context");
    expect(hunks[0]?.lines).toEqual([
      { kind: "context", oldNo: 1, newNo: 1, text: "keep" },
      { kind: "del", oldNo: 2, newNo: null, text: "removed one" },
      { kind: "del", oldNo: 3, newNo: null, text: "removed two" },
      { kind: "add", oldNo: null, newNo: 2, text: "added one" },
      { kind: "context", oldNo: 4, newNo: 3, text: "keep too" }
    ]);
    expect(hunks[1]?.lines.map((line) => [line.kind, line.oldNo, line.newNo])).toEqual([
      ["del", 20, null],
      ["note", null, null],
      ["add", null, 20],
      ["add", null, 21]
    ]);
  });

  it("treats an empty line inside a hunk as an empty context line", () => {
    const { hunks } = parsePatch("@@ -1,2 +1,2 @@\n a\n\n");
    expect(hunks[0]?.lines).toEqual([
      { kind: "context", oldNo: 1, newNo: 1, text: "a" },
      { kind: "context", oldNo: 2, newNo: 2, text: "" }
    ]);
  });

  it("recognises a binary file", () => {
    const parsed = parsePatch(
      "diff --git a/x.png b/x.png\nindex 1..2 100644\nBinary files a/x.png and b/x.png differ\n"
    );
    expect(parsed.binary).toBe(true);
    expect(parsed.hunks).toEqual([]);
  });

  it("copes with an empty patch", () => {
    expect(parsePatch("")).toEqual({ meta: [], hunks: [], binary: false });
  });

  it("does not mistake a removed line that starts with dashes for a header", () => {
    const { hunks } = parsePatch("@@ -1 +1 @@\n--- a\n+++ b\n");
    expect(hunks[0]?.lines.map((line) => [line.kind, line.text])).toEqual([
      ["del", "-- a"],
      ["add", "++ b"]
    ]);
  });
});

describe("toSideBySide", () => {
  it("sets each run of removed lines beside the run of added lines", () => {
    const { hunks } = parsePatch(PATCH);
    const rows = toSideBySide(hunks[0]?.lines ?? []);

    expect(rows.map((row) => [row.left?.text ?? null, row.right?.text ?? null])).toEqual([
      ["keep", "keep"],
      ["removed one", "added one"],
      ["removed two", null],
      ["keep too", "keep too"]
    ]);
  });

  it("leaves the left empty for lines that were only added", () => {
    const { hunks } = parsePatch("@@ -0,0 +1,2 @@\n+a\n+b\n");
    const rows = toSideBySide(hunks[0]?.lines ?? []);

    expect(rows.map((row) => row.left)).toEqual([null, null]);
    expect(rows.map((row) => row.right?.text)).toEqual(["a", "b"]);
  });
});
