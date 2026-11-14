import { batch, computed, signal } from "@preact/signals";

import type { GitCommitNode } from "@/backend/types";
import { UNCOMMITTED_CHANGES } from "@/webview/constants";
import { commitList } from "@/webview/lib/stores";
import { getCommitDate } from "@/webview/utils/date";

import { findMatches } from "./findMatches";

export const findOpen = signal(false);
export const findQuery = signal("");
export const findCaseSensitive = signal(false);
export const findRegex = signal(false);
/** Which of the matches is the current one, counted from 0. */
export const findCurrent = signal(0);
/** Raised to move the cursor back to the field, as when the shortcut is pressed while it is open. */
export const findFocusRequest = signal(0);

/** The texts a commit is recognised by: what its row shows, and what the row does not have room for. */
function searchTexts(commit: GitCommitNode): string[] {
  if (commit.hash === UNCOMMITTED_CHANGES) {
    return [];
  }
  const date = getCommitDate(commit.date);
  return [
    commit.message,
    commit.hash,
    commit.author,
    commit.email,
    ...commit.refs.map((ref) => ref.name),
    // The date as the row shows it (it may be relative), and the absolute one.
    date.value,
    date.title
  ];
}

const entries = computed(() => commitList.value?.map(searchTexts) ?? []);

export const findResult = computed(() =>
  findOpen.value
    ? findMatches(entries.value, findQuery.value, {
        caseSensitive: findCaseSensitive.value,
        regex: findRegex.value
      })
    : { indices: [], invalid: false }
);

/** The current match, kept inside the matches when a refresh leaves fewer of them. */
export const findPosition = computed(() =>
  Math.min(findCurrent.value, Math.max(findResult.value.indices.length - 1, 0))
);

export function openFind(): void {
  batch(() => {
    findOpen.value = true;
    findFocusRequest.value++;
  });
}

export function closeFind(): void {
  findOpen.value = false;
}

/** A new search starts at its first match. */
export function setFindQuery(query: string): void {
  batch(() => {
    findQuery.value = query;
    findCurrent.value = 0;
  });
}

export function toggleFindCase(): void {
  batch(() => {
    findCaseSensitive.value = !findCaseSensitive.value;
    findCurrent.value = 0;
  });
}

export function toggleFindRegex(): void {
  batch(() => {
    findRegex.value = !findRegex.value;
    findCurrent.value = 0;
  });
}

/** Move to the next match (`1`) or the previous one (`-1`), wrapping round. */
export function moveFind(step: 1 | -1): void {
  const count = findResult.value.indices.length;
  if (count === 0) {
    return;
  }
  findCurrent.value = (findPosition.value + step + count) % count;
}
