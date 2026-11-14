import { createBridge } from "@/orca/panel/bridge";
import { copyText } from "@/orca/panel/clipboard";
import { showDiff } from "@/orca/panel/diff/diffStore";

/**
 * Replaces `src/webview/lib/vscode.ts` in the Orca build (`esbuild.orca.js` aliases the module).
 * Upstream's file is `export const vscode = acquireVsCodeApi()`; this exports the same shape,
 * backed by Orca's `plugin.request` instead of VS Code's message channel.
 */
const bridge = createBridge({
  plugin: window.orca.plugin,
  dispatch: (data) => window.dispatchEvent(new MessageEvent("message", { data })),
  showDiff,
  copyText,
  locale: window.orca.locale,
  // eslint-disable-next-line no-console
  log: (message, error) => console.error(message, error)
});

bridge.listen();

let state: unknown;

export const vscode = {
  getState: (): unknown => state,
  setState: (value: unknown): void => {
    state = value;
  },
  postMessage: (message: unknown): void => {
    void bridge.send(message);
  }
};
