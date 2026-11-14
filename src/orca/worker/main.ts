import { REQUEST } from "@/orca/shared/protocol";
import type { OrcaWorkerApi } from "@/orca/types/orca-api";

import { createRuntime, type Runtime } from "./runtime";

let runtime: Runtime | undefined;

/**
 * Entry point of the plugin's worker (`main` in `orca-plugin.json`, bundled by `esbuild.orca.js`).
 * It runs the Git work the VS Code extension's host did, and answers the panel's requests.
 */
export default async function activate(orca: OrcaWorkerApi): Promise<void> {
  const current = createRuntime(orca);
  runtime = current;
  await current.init();

  orca.panels.handle(REQUEST.rpc, (input) => current.handleRpc(input));
  orca.panels.handle(REQUEST.msg, (input) => current.handleMessage(input));
  orca.panels.handle(REQUEST.diff, (input) => current.handleDiff(input));
  orca.panels.handle(REQUEST.fetch, (input) => current.handleFetch(input));

  orca.events.on("workspace.created", (payload) => current.onWorkspaceCreated(payload));
  orca.events.on("workspace.removed", (payload) => current.onWorkspaceRemoved(payload));
  orca.events.on("workspace.changed", (payload) => current.onWorkspaceChanged(payload));
}

export function deactivate(): void {
  runtime?.dispose();
  runtime = undefined;
}
