import { effect } from "@preact/signals";

import { ROW_HEIGHT, TABLE_HEADER_HEIGHT } from "@/webview/constants";
import { commitList, expandedCommit } from "@/webview/lib/stores";
import { rowTop } from "@/webview/utils/rowWindow";

import {
  findCaseSensitive,
  findCurrent,
  findOpen,
  findPosition,
  findQuery,
  findRegex,
  findResult
} from "./findStore";

const MARK = "data-gg-match";

/**
 * The hash of a commit row. Its last cell is the abbreviated hash, with the whole hash as its tooltip.
 * The rows that are not commits (a blank stand-in for rows left out, the details view) have no such
 * cell and give `null`.
 */
function hashOf(row: HTMLTableRowElement): string | null {
  return row.lastElementChild?.getAttribute("title") ?? null;
}

/**
 * Marks the rows that match: `match`, and `current` on the one the person is at.
 *
 * The table draws only the rows near the view, so a row cannot be found by its position among the
 * rows: each is recognised by its commit's hash, and only those drawn are marked. The rest are marked
 * as they are drawn, by the observer below.
 *
 * The mark is a data attribute, not a class: upstream's rows set their `class` when they render, which
 * would wipe a class added here, and know nothing of an attribute they never set.
 */
function mark(scrollToCurrent: boolean): void {
  if (!findOpen.value) {
    for (const row of document.querySelectorAll(`[${MARK}]`)) {
      row.removeAttribute(MARK);
    }
    return;
  }

  const { indices } = findResult.value;
  const commits = commitList.value ?? [];
  const position = findPosition.value;

  const marks = new Map<string, "match" | "current">();
  for (const [place, commitIndex] of indices.entries()) {
    const hash = commits[commitIndex]?.hash;
    if (hash !== undefined) {
      marks.set(hash, place === position ? "current" : "match");
    }
  }

  for (const row of document.querySelectorAll<HTMLTableRowElement>("table > tbody > tr")) {
    const hash = hashOf(row);
    const kind = hash === null ? undefined : marks.get(hash);
    if (kind === undefined) {
      row.removeAttribute(MARK);
    } else {
      row.setAttribute(MARK, kind);
    }
  }

  const current = indices[position];
  if (scrollToCurrent && current !== undefined) {
    scrollToCommit(current);
  }
}

/**
 * Scrolls so the commit at `index` is in the middle of the view. The row may not be drawn yet, so this
 * works from where the table puts it: the rows are `ROW_HEIGHT` high, below the header, and an open
 * commit's details view pushes the rows under it down. Scrolling draws the row.
 */
function scrollToCommit(index: number): void {
  const table = document.querySelector("table");
  if (table === null) {
    return;
  }

  const commits = commitList.peek() ?? [];
  const expandedHash = expandedCommit.peek();
  const expandedRow =
    expandedHash === null ? -1 : commits.findIndex((commit) => commit.hash === expandedHash);

  const firstRowTop = table.getBoundingClientRect().top + window.scrollY + TABLE_HEADER_HEIGHT;
  window.scrollTo({
    top: firstRowTop + rowTop(index, expandedRow) - window.innerHeight / 2 + ROW_HEIGHT / 2
  });
}

/**
 * Keeps the matching rows marked, and scrolls to the current one when the search or the current match
 * moves, but not when the commits are only reloaded.
 */
export function installFindHighlight(): void {
  let lastSearch: string | null = null;

  effect(() => {
    // What the search is. `mark` reads the matches inside this effect, so they are tracked as well.
    const search = [
      findOpen.value,
      findQuery.value,
      findCaseSensitive.value,
      findRegex.value,
      findCurrent.value
    ].join("|");

    const moved = search !== lastSearch;
    lastSearch = findOpen.value ? search : null;
    mark(moved);
  });

  // The rows are drawn again when the commits load; mark the new ones. Marking changes attributes,
  // which are not watched, so this cannot loop.
  let frame = 0;
  new MutationObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => mark(false));
  }).observe(document.body, { childList: true, subtree: true });
}
