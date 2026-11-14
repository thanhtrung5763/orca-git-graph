import { describe, expect, it, vi } from "vitest";

import { AUTHOR_MAX_WIDTH, CELL_PADDING, fitColumns } from "@/webview/utils/columnFit";

/** Ten pixels a character, so a width is easy to read off a text. */
const measure = (text: string) => text.length * 10;

describe("fitColumns", () => {
  it("takes the widest date and the widest author, with the cell's padding", () => {
    const { date, author } = fitColumns({
      dates: ["Sep 3", "Sep 28, 2026 00:23", "May 1"],
      authors: ["Al", "Alexandra", "Bo"],
      measure
    });

    expect(date).toBe(18 * 10 + CELL_PADDING);
    expect(author).toBe(9 * 10 + CELL_PADDING);
  });

  it("stops an author at the width a cell is cut off at", () => {
    const { author } = fitColumns({
      dates: ["d"],
      authors: ["A name that is much too long to fit"],
      measure
    });

    expect(author).toBe(AUTHOR_MAX_WIDTH);
  });

  it("does not stop a date, whose cell is not cut off", () => {
    const { date } = fitColumns({ dates: ["x".repeat(40)], authors: ["a"], measure });

    expect(date).toBe(40 * 10 + CELL_PADDING);
  });

  it("keeps a fractional width, as the browser lays a column out to the pixel fraction", () => {
    const { date } = fitColumns({ dates: ["a"], authors: ["a"], measure: () => 20.2 });

    expect(date).toBeCloseTo(20.2 + CELL_PADDING, 5);
  });

  it("measures each text once, however many commits share it", () => {
    const counting = vi.fn(measure);

    fitColumns({
      dates: ["d1", "d1", "d1", "d2"],
      authors: Array.from({ length: 1000 }, () => "Same Author"),
      measure: counting
    });

    expect(counting).toHaveBeenCalledTimes(3);
  });

  it("copes with no commits", () => {
    expect(fitColumns({ dates: [], authors: [], measure })).toEqual({
      date: CELL_PADDING,
      author: CELL_PADDING
    });
  });
});
