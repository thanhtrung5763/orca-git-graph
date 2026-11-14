import type { GitFileChangeType } from "@/backend/types";
import type {
  RequestMessage,
  ResponseMessage,
  RpcNotificationMap,
  RpcNotificationName
} from "@/types";

/**
 * The panel <-> worker contract.
 *
 * neo-git-graph's webview talks to its host with `postMessage`: `{ command }` messages and
 * `{ kind: "rpc.request" }` envelopes. The panel shim (`src/orca/panel/bridge.ts`) turns each one
 * into one of the `plugin.request` calls below, and turns the answer back into the message the
 * webview expects, so the webview code runs unchanged.
 */

export const REQUEST = {
  /** An RPC call (`webview.initialize`, `repo.scan`, ...). */
  rpc: "gg.rpc",
  /** A legacy `{ command }` message: git queries and actions. */
  msg: "gg.msg",
  /** The patch of one file of a commit, for the in-panel diff viewer. */
  diff: "gg.diff",
  /** One part of an answer that was too large to send at once. */
  fetch: "gg.fetch"
} as const;

/** Pushed by the worker to every open panel. */
export const EVENT_NOTIFY = "gg.notify";

/**
 * Pushed when Orca focuses another workspace, so the panel can show that workspace's repository
 * instead of the one it was left on. Not part of the webview's notifications: the panel resolves
 * the workspace path against its repository list and selects the repository there.
 */
export const EVENT_FOCUS_REPO = "gg.focusRepo";

export type FocusRepoEvent = { path: string };

/** Orca allows an answer of 1 MiB; larger ones are split and fetched part by part. */
export type Answer<T> = { data: T } | { chunked: { id: string; parts: number } };

export type RpcInput = { method: string; params: unknown };
export type RpcOutput = { ok: true; result: unknown } | { ok: false; error: string };

export type MsgInput = RequestMessage;
export type MsgOutput = { messages: ResponseMessage[] };

export type DiffInput = Extract<RequestMessage, { command: "viewDiff" }>;
export type DiffPayload = {
  /** Window title, e.g. `main.ts (Added in 1a2b3c4)`. */
  title: string;
  commitHash: string;
  oldFilePath: string;
  newFilePath: string;
  type: GitFileChangeType;
  /** `git diff` output for the file: extended headers and hunks. */
  patch: string;
  /** The patch was cut at the size limit. */
  truncated: boolean;
};
export type DiffOutput = { ok: true; diff: DiffPayload } | { ok: false };

export type FetchInput = { id: string; part: number };
export type FetchOutput = { chunk: string };

export type NotifyEvent<N extends RpcNotificationName = RpcNotificationName> = N extends N
  ? { name: N; message: RpcNotificationMap[N] }
  : never;

/** Commands whose response carries a `status` (`null` on success, else the git error). */
export const ACTION_COMMANDS = [
  "addTag",
  "checkoutBranch",
  "checkoutCommit",
  "cherrypickCommit",
  "createBranch",
  "deleteBranch",
  "deleteTag",
  "mergeBranch",
  "mergeCommit",
  "pushTag",
  "renameBranch",
  "resetToCommit",
  "revertCommit"
] as const;

export type ActionCommand = (typeof ACTION_COMMANDS)[number];

export function isActionCommand(command: string): command is ActionCommand {
  return (ACTION_COMMANDS as readonly string[]).includes(command);
}
