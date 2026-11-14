export type FindOptions = {
  caseSensitive: boolean;
  /** Read the query as a regular expression instead of words. */
  regex: boolean;
};

export type FindResult = {
  /** Positions in `entries` of the commits that match, in order. */
  indices: number[];
  /** The query is a regular expression that does not parse. */
  invalid: boolean;
};

const NOTHING: FindResult = { indices: [], invalid: false };

/**
 * Which commits match a search. `entries` holds, for each commit, the texts a person can see or
 * recognise it by: its description, hash, author, branch and tag names, date. A commit with no texts
 * (the row of uncommitted changes) never matches.
 *
 * As text, the query has to appear in one of a commit's texts: a part of a description, a part of a
 * hash. Words are not matched one by one across the texts; with the date among them a short word
 * like "3" would match nearly every commit. As a regular expression it has to match one of the
 * texts on its own, so `^fix` means a description that starts with "fix".
 */
export function findMatches(
  entries: readonly (readonly string[])[],
  query: string,
  options: FindOptions
): FindResult {
  const wanted = query.trim();
  if (wanted === "") {
    return NOTHING;
  }

  let matches: (text: string) => boolean;
  if (options.regex) {
    try {
      const pattern = new RegExp(wanted, options.caseSensitive ? "" : "i");
      matches = (text) => pattern.test(text);
    } catch {
      return { indices: [], invalid: true };
    }
  } else {
    const needle = options.caseSensitive ? wanted : wanted.toLowerCase();
    matches = (text) => (options.caseSensitive ? text : text.toLowerCase()).includes(needle);
  }

  const indices: number[] = [];
  for (const [index, texts] of entries.entries()) {
    if (texts.some(matches)) {
      indices.push(index);
    }
  }
  return { indices, invalid: false };
}
