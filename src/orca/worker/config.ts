import type { DateType } from "@/backend/types";
import type { DateFormat, GraphStyle } from "@/types";

export type OrcaConfig = {
  autoCenterCommitDetailsView: boolean;
  dateFormat: DateFormat;
  dateType: DateType;
  graphColours: string[];
  graphStyle: GraphStyle;
  initialLoadCommits: number;
  loadMoreCommits: number;
  maxDepthOfRepoSearch: number;
  showCurrentBranchByDefault: boolean;
  showUncommittedChanges: boolean;
  /** Write git's commit-graph file for a repository whose log is slow to open. */
  writeCommitGraph: boolean;
  /** Always set: `git` when the person left the setting empty. */
  gitPath: string;
};

/** Mirrors the defaults declared in `orca-plugin.json`; a test keeps the two in step. */
export const DEFAULT_CONFIG: OrcaConfig = {
  autoCenterCommitDetailsView: true,
  dateFormat: "Date & Time",
  dateType: "Author Date",
  graphColours: [
    "#0085d9",
    "#d9008f",
    "#00d90a",
    "#d98500",
    "#a300d9",
    "#ff0000",
    "#00d9cc",
    "#e138e8",
    "#85d900",
    "#dc5b23",
    "#6f24d6",
    "#ffcc00"
  ],
  graphStyle: "rounded",
  initialLoadCommits: 300,
  loadMoreCommits: 100,
  maxDepthOfRepoSearch: 0,
  showCurrentBranchByDefault: false,
  showUncommittedChanges: true,
  writeCommitGraph: true,
  gitPath: "git"
};

const COLOUR_PATTERN =
  /^\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|rgb[a]?\s*\(\d{1,3},\s*\d{1,3},\s*\d{1,3}\))\s*$/;

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function integer(value: unknown, fallback: number, min: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min ? value : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.find((candidate) => candidate === value) ?? fallback;
}

/** Splits the semicolon separated `graphColours` setting, dropping entries that are not colours. */
export function parseColours(value: unknown): string[] {
  if (typeof value !== "string") {
    return DEFAULT_CONFIG.graphColours;
  }
  const colours = value
    .split(";")
    .filter((entry) => COLOUR_PATTERN.test(entry))
    .map((entry) => entry.trim());
  return colours.length > 0 ? colours : DEFAULT_CONFIG.graphColours;
}

/** Reads the plugin's settings (`settings.get`), falling back to the default for any bad value. */
export function parseConfig(raw: Readonly<Record<string, unknown>>): OrcaConfig {
  const gitPath = typeof raw["gitPath"] === "string" ? raw["gitPath"].trim() : "";

  return {
    autoCenterCommitDetailsView: bool(
      raw["autoCenterCommitDetailsView"],
      DEFAULT_CONFIG.autoCenterCommitDetailsView
    ),
    dateFormat: oneOf(
      raw["dateFormat"],
      ["Date & Time", "Date Only", "Relative"],
      DEFAULT_CONFIG.dateFormat
    ),
    dateType: oneOf(raw["dateType"], ["Author Date", "Commit Date"], DEFAULT_CONFIG.dateType),
    graphColours: parseColours(raw["graphColours"]),
    graphStyle: oneOf(raw["graphStyle"], ["rounded", "angular"], DEFAULT_CONFIG.graphStyle),
    initialLoadCommits: integer(raw["initialLoadCommits"], DEFAULT_CONFIG.initialLoadCommits, 1),
    loadMoreCommits: integer(raw["loadMoreCommits"], DEFAULT_CONFIG.loadMoreCommits, 1),
    maxDepthOfRepoSearch: integer(
      raw["maxDepthOfRepoSearch"],
      DEFAULT_CONFIG.maxDepthOfRepoSearch,
      0
    ),
    showCurrentBranchByDefault: bool(
      raw["showCurrentBranchByDefault"],
      DEFAULT_CONFIG.showCurrentBranchByDefault
    ),
    showUncommittedChanges: bool(
      raw["showUncommittedChanges"],
      DEFAULT_CONFIG.showUncommittedChanges
    ),
    writeCommitGraph: bool(raw["writeCommitGraph"], DEFAULT_CONFIG.writeCommitGraph),
    gitPath: gitPath === "" ? DEFAULT_CONFIG.gitPath : gitPath
  };
}
