import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG, parseColours, parseConfig } from "@/orca/worker/config";

const root = path.resolve(import.meta.dirname, "../..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "orca-plugin.json"), "utf8")) as {
  contributes: { settings: { key: string; default?: unknown }[] };
};

describe("parseConfig", () => {
  it("returns the defaults when nothing is set", () => {
    expect(parseConfig({})).toEqual(DEFAULT_CONFIG);
  });

  it("reads the defaults declared in orca-plugin.json as the defaults", () => {
    const declared = Object.fromEntries(
      manifest.contributes.settings.map((setting) => [setting.key, setting.default])
    );
    expect(parseConfig(declared)).toEqual(DEFAULT_CONFIG);
  });

  it("declares at most 64 settings, each once", () => {
    const keys = manifest.contributes.settings.map((setting) => setting.key);
    expect(keys.length).toBeLessThanOrEqual(64);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("uses values of the right kind and falls back for the rest", () => {
    expect(
      parseConfig({
        autoCenterCommitDetailsView: false,
        dateFormat: "Relative",
        dateType: "Commit Date",
        graphStyle: "angular",
        initialLoadCommits: 50,
        loadMoreCommits: 25,
        maxDepthOfRepoSearch: 3,
        showCurrentBranchByDefault: true,
        showUncommittedChanges: false
      })
    ).toMatchObject({
      autoCenterCommitDetailsView: false,
      dateFormat: "Relative",
      dateType: "Commit Date",
      graphStyle: "angular",
      initialLoadCommits: 50,
      loadMoreCommits: 25,
      maxDepthOfRepoSearch: 3,
      showCurrentBranchByDefault: true,
      showUncommittedChanges: false
    });

    expect(
      parseConfig({
        autoCenterCommitDetailsView: "yes",
        dateFormat: "Weekdays",
        graphStyle: 3,
        initialLoadCommits: 0,
        loadMoreCommits: 1.5,
        maxDepthOfRepoSearch: -1,
        showUncommittedChanges: null
      })
    ).toEqual(DEFAULT_CONFIG);
  });

  it("uses git from PATH when the Git executable is empty, and trims a path", () => {
    expect(parseConfig({ gitPath: "" }).gitPath).toBe("git");
    expect(parseConfig({ gitPath: "   " }).gitPath).toBe("git");
    expect(parseConfig({ gitPath: " /opt/bin/git " }).gitPath).toBe("/opt/bin/git");
  });
});

describe("parseColours", () => {
  it("splits on semicolons and trims", () => {
    expect(parseColours("#112233; #aabbccdd ;rgb(1, 2, 3)")).toEqual([
      "#112233",
      "#aabbccdd",
      "rgb(1, 2, 3)"
    ]);
  });

  it("drops entries that are not colours", () => {
    expect(parseColours("#112233;red;#12;")).toEqual(["#112233"]);
  });

  it("falls back to the defaults when no colour is left", () => {
    expect(parseColours("red;blue")).toEqual(DEFAULT_CONFIG.graphColours);
    expect(parseColours("")).toEqual(DEFAULT_CONFIG.graphColours);
    expect(parseColours(undefined)).toEqual(DEFAULT_CONFIG.graphColours);
  });
});
