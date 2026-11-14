import { effect } from "@preact/signals";

import { EVENT_FOCUS_REPO } from "@/orca/shared/protocol";
import { selectRepo } from "@/webview/lib/actions";
import { selectedRepo } from "@/webview/lib/stores";
import { repoListStore } from "@/webview/lib/stores/repo-list.store";

import { closeDiff } from "./diff/diffStore";
import { findRepoForWorkspace } from "./focusRepo";

function isFocusEvent(payload: unknown): payload is { path: string } {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "path" in payload &&
    typeof (payload as { path: unknown }).path === "string"
  );
}

/**
 * Moves the panel to the repository of the workspace Orca focuses, so switching projects in Orca's
 * sidebar switches the graph with it. The worker sends this only when the focused workspace really
 * changes, not when its terminals do.
 */
export function installWorkspaceFocus(): void {
  /** A focused workspace whose repository is not known yet (the list is still loading, or the
   * workspace was just created), applied as soon as it is. */
  let pending: string | null = null;

  function follow(): void {
    const repos = repoListStore.get();
    if (repos === undefined || pending === null) {
      return;
    }

    const repo = findRepoForWorkspace(pending, repos);
    if (repo === undefined) {
      return;
    }

    pending = null;
    if (repo === selectedRepo.value) {
      return;
    }

    // A diff of the repository being left would otherwise stay open over the new graph.
    closeDiff();
    selectRepo(repo);
  }

  window.orca.plugin.on(EVENT_FOCUS_REPO, (payload) => {
    if (!isFocusEvent(payload)) {
      return;
    }
    pending = payload.path;
    follow();
  });

  // The focus can arrive before the panel has scanned the repositories, and its repository can be
  // added to the list a moment later.
  effect(() => {
    repoListStore.get();
    follow();
  });
}
