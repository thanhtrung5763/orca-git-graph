import { openDiff } from "@/orca/panel/diff/diffStore";
import { contextMenu, dialog } from "@/webview/lib/stores";

import { openFind } from "./findStore";

/**
 * Ctrl/Cmd+Shift+F opens the search. Ctrl/Cmd+F does too, which is the key the original Git Graph
 * used, and the one to reach for if Orca keeps the shifted one for its own search.
 *
 * It waits while the diff viewer, a menu or a dialog is up: they are on top of the graph.
 */
export function installFindShortcut(): void {
  // In the capture phase, so no element of the page can swallow it first.
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key.toLowerCase() !== "f" || event.altKey || !(event.metaKey || event.ctrlKey)) {
        return;
      }
      if (openDiff.value !== null || contextMenu.value !== null || dialog.value !== null) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      openFind();
    },
    true
  );
}
