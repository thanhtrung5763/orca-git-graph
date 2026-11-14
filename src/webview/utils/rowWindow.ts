import { COMMIT_DETAILS_HEIGHT, ROW_HEIGHT } from "@/webview/constants";

/** The rows `start` up to, but not including, `end`. */
export type RowWindow = { start: number; end: number };

/** What the table draws: rows, and blank rows that stand in for the ones it leaves out. */
export type RowPlan = Array<{ kind: "spacer"; height: number } | { kind: "row"; index: number }>;

/** Rows drawn beyond those in view, on each side, so a scroll does not show a gap before the next render. */
const OVERSCAN = 30;

/** The window moves in steps of this many rows, so scrolling does not redraw the table for every row. */
const CHUNK = 20;

/**
 * Pixels from the top of the first row to the top of row `index`, when the details view of
 * `expandedRow` is open (`-1` when none is). The rows below the open commit sit under its details.
 */
export function rowTop(
  index: number,
  expandedRow: number,
  detailsHeight: number = COMMIT_DETAILS_HEIGHT
): number {
  return index * ROW_HEIGHT + (expandedRow !== -1 && index > expandedRow ? detailsHeight : 0);
}

/**
 * The row at `offset` pixels below the top of the first row. An offset inside an open details view
 * belongs to the commit it opens under. The answer stays within the rows there are.
 */
export function rowAt(
  offset: number,
  count: number,
  expandedRow: number,
  detailsHeight: number = COMMIT_DETAILS_HEIGHT
): number {
  if (count === 0) {
    return 0;
  }

  let row: number;
  if (expandedRow === -1 || offset < (expandedRow + 1) * ROW_HEIGHT) {
    row = Math.floor(offset / ROW_HEIGHT);
  } else if (offset < (expandedRow + 1) * ROW_HEIGHT + detailsHeight) {
    row = expandedRow;
  } else {
    row = Math.floor((offset - detailsHeight) / ROW_HEIGHT);
  }
  return Math.min(Math.max(row, 0), count - 1);
}

/**
 * The rows to draw for a view of `viewportHeight` pixels whose top is `scrollTop` pixels below the top
 * of the first row (negative while the rows are still below the top of the view): those in view, and
 * some on each side, rounded out to whole chunks.
 */
export function visibleWindow(input: {
  scrollTop: number;
  viewportHeight: number;
  count: number;
  expandedRow: number;
  overscan?: number;
  chunk?: number;
  detailsHeight?: number;
}): RowWindow {
  const { scrollTop, viewportHeight, count, expandedRow } = input;
  const { overscan = OVERSCAN, chunk = CHUNK, detailsHeight = COMMIT_DETAILS_HEIGHT } = input;

  const first = rowAt(scrollTop, count, expandedRow, detailsHeight);
  const last = rowAt(scrollTop + viewportHeight, count, expandedRow, detailsHeight);
  return {
    start: Math.max(0, Math.floor((first - overscan) / chunk) * chunk),
    end: Math.min(count, Math.ceil((last + 1 + overscan) / chunk) * chunk)
  };
}

/**
 * What to draw, top to bottom: the rows of the window, the open commit (always, wherever it is, because
 * its details view scrolls itself into view when it appears and must not appear again each time the
 * person scrolls past it), and a spacer for each run of rows left out, so the table keeps its height.
 */
export function planRows(count: number, window: RowWindow, expandedRow: number): RowPlan {
  const end = Math.min(window.end, count);
  const start = Math.min(window.start, end);

  const runs: Array<[number, number]> = [];
  if (expandedRow !== -1 && expandedRow < start) {
    runs.push([expandedRow, expandedRow + 1]);
  }
  runs.push([start, end]);
  if (expandedRow !== -1 && expandedRow >= end) {
    runs.push([expandedRow, expandedRow + 1]);
  }

  const plan: RowPlan = [];
  let drawn = 0;
  for (const [from, to] of runs) {
    if (from > drawn) {
      plan.push({ kind: "spacer", height: (from - drawn) * ROW_HEIGHT });
    }
    for (let index = from; index < to; index++) {
      plan.push({ kind: "row", index });
    }
    drawn = Math.max(drawn, to);
  }
  if (count > drawn) {
    plan.push({ kind: "spacer", height: (count - drawn) * ROW_HEIGHT });
  }
  return plan;
}
