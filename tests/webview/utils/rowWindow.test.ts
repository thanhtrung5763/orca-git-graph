import { describe, expect, it } from "vitest";

import { COMMIT_DETAILS_HEIGHT, ROW_HEIGHT } from "@/webview/constants";
import { planRows, rowAt, rowTop, visibleWindow } from "@/webview/utils/rowWindow";

const D = COMMIT_DETAILS_HEIGHT;

describe("rowTop", () => {
  it("puts row n at n rows from the top", () => {
    expect(rowTop(0, -1)).toBe(0);
    expect(rowTop(10, -1)).toBe(10 * ROW_HEIGHT);
  });

  it("moves the rows below an open commit down by its details view, and not the commit itself", () => {
    expect(rowTop(4, 5)).toBe(4 * ROW_HEIGHT);
    expect(rowTop(5, 5)).toBe(5 * ROW_HEIGHT);
    expect(rowTop(6, 5)).toBe(6 * ROW_HEIGHT + D);
  });
});

describe("rowAt", () => {
  it("finds the row under an offset, by the row height", () => {
    expect(rowAt(0, 100, -1)).toBe(0);
    expect(rowAt(ROW_HEIGHT - 1, 100, -1)).toBe(0);
    expect(rowAt(ROW_HEIGHT, 100, -1)).toBe(1);
    expect(rowAt(10 * ROW_HEIGHT + 5, 100, -1)).toBe(10);
  });

  it("agrees with rowTop for the first pixel of every row, with or without an open commit", () => {
    for (const expandedRow of [-1, 0, 7, 99]) {
      for (let index = 0; index < 100; index++) {
        expect(rowAt(rowTop(index, expandedRow), 100, expandedRow)).toBe(index);
        expect(rowAt(rowTop(index, expandedRow) + ROW_HEIGHT - 1, 100, expandedRow)).toBe(index);
      }
    }
  });

  it("gives an offset inside the details view to the commit it opens under", () => {
    const top = (5 + 1) * ROW_HEIGHT;

    expect(rowAt(top, 100, 5)).toBe(5);
    expect(rowAt(top + D - 1, 100, 5)).toBe(5);
    expect(rowAt(top + D, 100, 5)).toBe(6);
  });

  it("stays within the rows there are", () => {
    expect(rowAt(-500, 100, -1)).toBe(0);
    expect(rowAt(1e9, 100, -1)).toBe(99);
    expect(rowAt(1e9, 100, 7)).toBe(99);
    expect(rowAt(40, 0, -1)).toBe(0);
  });
});

describe("visibleWindow", () => {
  const view = { viewportHeight: 800, expandedRow: -1 };

  it("shows the first rows, and some more, at the top", () => {
    const { start, end } = visibleWindow({ ...view, scrollTop: 0, count: 5000 });

    expect(start).toBe(0);
    // 800px is 33 rows; with 30 more below, rounded up to a whole chunk of 20.
    expect(end).toBe(80);
  });

  it("moves in whole chunks, and holds still while a scroll stays within one", () => {
    const at = (scrollTop: number) => visibleWindow({ ...view, scrollTop, count: 5000 });

    expect(at(0).start % 20).toBe(0);
    expect(at(2000)).toEqual(at(2000 + ROW_HEIGHT));
    expect(at(2000)).not.toEqual(at(2000 + 20 * ROW_HEIGHT));
  });

  it("always covers what is in view", () => {
    for (const expandedRow of [-1, 3, 400, 4999]) {
      for (let scrollTop = -100; scrollTop < 5000 * ROW_HEIGHT + D; scrollTop += 977) {
        const { start, end } = visibleWindow({
          scrollTop,
          viewportHeight: 800,
          count: 5000,
          expandedRow
        });
        const first = rowAt(scrollTop, 5000, expandedRow);
        const last = rowAt(scrollTop + 800, 5000, expandedRow);

        expect(start).toBeLessThanOrEqual(first);
        expect(end).toBeGreaterThan(last);
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeLessThanOrEqual(5000);
      }
    }
  });

  it("shows every row of a short table", () => {
    expect(visibleWindow({ ...view, scrollTop: 0, count: 12 })).toEqual({ start: 0, end: 12 });
    expect(visibleWindow({ ...view, scrollTop: 0, count: 0 })).toEqual({ start: 0, end: 0 });
  });

  it("stays small however long the history is", () => {
    const { start, end } = visibleWindow({ ...view, scrollTop: 100_000, count: 169_000 });

    expect(end - start).toBeLessThan(140);
  });
});

const heightOf = (plan: ReturnType<typeof planRows>) =>
  plan.reduce((sum, item) => sum + (item.kind === "spacer" ? item.height : ROW_HEIGHT), 0);
const rowsOf = (plan: ReturnType<typeof planRows>) =>
  plan.flatMap((item) => (item.kind === "row" ? [item.index] : []));

describe("planRows", () => {
  it("draws every row of a window that covers the table, with no spacer", () => {
    const plan = planRows(30, { start: 0, end: 30 }, -1);

    expect(plan.every((item) => item.kind === "row")).toBe(true);
    expect(rowsOf(plan)).toEqual(Array.from({ length: 30 }, (_, index) => index));
  });

  it("stands in for the rows above and below the window with spacers of their height", () => {
    const plan = planRows(1000, { start: 100, end: 160 }, -1);

    expect(plan[0]).toEqual({ kind: "spacer", height: 100 * ROW_HEIGHT });
    expect(plan.at(-1)).toEqual({ kind: "spacer", height: 840 * ROW_HEIGHT });
    expect(rowsOf(plan)).toEqual(Array.from({ length: 60 }, (_, index) => 100 + index));
  });

  it("keeps the table as tall as its rows, wherever the window is", () => {
    for (const start of [0, 40, 480, 960]) {
      const plan = planRows(1000, { start, end: start + 40 }, -1);

      expect(heightOf(plan)).toBe(1000 * ROW_HEIGHT);
    }
  });

  it("keeps drawing the open commit when it is above the window, in its place", () => {
    const plan = planRows(1000, { start: 500, end: 540 }, 20);

    expect(rowsOf(plan)).toEqual([20, ...Array.from({ length: 40 }, (_, index) => 500 + index)]);
    expect(plan[0]).toEqual({ kind: "spacer", height: 20 * ROW_HEIGHT });
    expect(plan[2]).toEqual({ kind: "spacer", height: 479 * ROW_HEIGHT });
    expect(heightOf(plan)).toBe(1000 * ROW_HEIGHT);
  });

  it("keeps drawing the open commit when it is below the window, in its place", () => {
    const plan = planRows(1000, { start: 100, end: 140 }, 900);

    expect(rowsOf(plan)).toEqual([...Array.from({ length: 40 }, (_, index) => 100 + index), 900]);
    expect(plan.at(-1)).toEqual({ kind: "spacer", height: 99 * ROW_HEIGHT });
    expect(heightOf(plan)).toBe(1000 * ROW_HEIGHT);
  });

  it("draws the open commit once when it is inside the window", () => {
    const plan = planRows(1000, { start: 100, end: 140 }, 120);

    expect(rowsOf(plan).filter((index) => index === 120)).toHaveLength(1);
    expect(heightOf(plan)).toBe(1000 * ROW_HEIGHT);
  });

  it("handles the open commit at either end of the table", () => {
    expect(heightOf(planRows(1000, { start: 500, end: 540 }, 0))).toBe(1000 * ROW_HEIGHT);
    expect(heightOf(planRows(1000, { start: 500, end: 540 }, 999))).toBe(1000 * ROW_HEIGHT);
  });

  it("copes with an empty table and a window past the end", () => {
    expect(planRows(0, { start: 0, end: 0 }, -1)).toEqual([]);
    expect(rowsOf(planRows(50, { start: 40, end: 400 }, -1))).toEqual(
      Array.from({ length: 10 }, (_, index) => 40 + index)
    );
  });
});
