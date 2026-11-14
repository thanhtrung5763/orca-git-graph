import { UNCOMMITTED_CHANGES } from "@/webview/constants";
import { toggleCommitDetails } from "@/webview/lib/actions";
import { commitList, contextMenu, dialog, expandedCommit } from "@/webview/lib/stores";

import { adjacentCommit } from "./commitNavigation";

const TEXT_ENTRY_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function isTextEntry(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || TEXT_ENTRY_TAGS.has(target.tagName))
  );
}

/**
 * Up and Down move through the commits, opening each one's details, as they do in the original Git
 * Graph. neo-git-graph's webview only reacts to the mouse here, so without this the arrow keys just
 * scroll the page.
 *
 * Menus, dialogs, dropdowns and text fields use the arrows themselves; they either say so
 * (`defaultPrevented`) or are checked for here.
 */
export function installCommitKeyboardNavigation(): void {
  document.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
      return;
    }
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }
    if (contextMenu.value !== null || dialog.value !== null || isTextEntry(event.target)) {
      return;
    }

    const commits = commitList.value;
    if (commits === undefined) {
      return;
    }

    const next = adjacentCommit(
      commits.map((commit) => commit.hash),
      expandedCommit.value,
      event.key === "ArrowUp" ? "up" : "down",
      UNCOMMITTED_CHANGES
    );
    if (next === undefined) {
      return;
    }

    event.preventDefault();
    toggleCommitDetails(next);
  });
}
