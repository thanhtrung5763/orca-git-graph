/** Horizontal padding of a cell of the commit table (`px-1`), in pixels, both sides together. */
export const CELL_PADDING = 8;

/** The widest an author cell grows (`max-w-31`), in pixels. A longer name is cut off with an ellipsis. */
export const AUTHOR_MAX_WIDTH = 124;

/**
 * The narrowest the date and author columns can be and still hold every commit's text.
 *
 * The browser sizes the columns of a table from the cells it has drawn. The table draws only the
 * rows near the view, so left to the browser the columns would change width as the person scrolls,
 * each time a wider date or name came into view. These widths come from the text of every commit, and
 * fix the columns for the whole history.
 */
export function fitColumns(input: {
  dates: Iterable<string>;
  authors: Iterable<string>;
  /** The width of a text in the font the cells use, in pixels. */
  measure: (text: string) => number;
}): { date: number; author: number } {
  const widest = (texts: Iterable<string>) => {
    // Many commits share an author and some share a date: each text is measured once.
    const seen = new Set<string>();
    let max = 0;
    for (const text of texts) {
      if (!seen.has(text)) {
        seen.add(text);
        max = Math.max(max, input.measure(text));
      }
    }
    return max;
  };

  // The widths are not rounded: the browser lays a column out to the pixel fraction, and a width a
  // little over would be a visible step wider than the layout it replaces.
  return {
    date: widest(input.dates) + CELL_PADDING,
    author: Math.min(widest(input.authors) + CELL_PADDING, AUTHOR_MAX_WIDTH)
  };
}
