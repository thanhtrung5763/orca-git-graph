export type Direction = "up" | "down";

/**
 * The commit the arrow keys move to from `current`, the commit whose details are open, or
 * `undefined` when there is nowhere to go.
 *
 * `skip` is the row that cannot be opened (uncommitted changes). With nothing open, Down opens the
 * first commit and Up does nothing, so the key keeps scrolling the page.
 */
export function adjacentCommit(
  hashes: readonly string[],
  current: string | null,
  direction: Direction,
  skip: string
): string | undefined {
  const openable = hashes.filter((hash) => hash !== skip);
  const index = current === null ? -1 : openable.indexOf(current);

  if (index === -1) {
    return direction === "down" ? openable[0] : undefined;
  }
  return openable[index + (direction === "down" ? 1 : -1)];
}
