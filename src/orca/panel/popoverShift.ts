/** Space kept between a menu and the edge of the panel, in pixels. */
const MARGIN = 8;

/**
 * How far to move a menu sideways so it lies inside the panel: left when it runs out of the right
 * edge, right when it starts before the left edge. When it is wider than the panel the left edge
 * wins, so its start stays readable.
 */
export function horizontalShift(
  rect: { left: number; right: number },
  viewportWidth: number,
  margin: number = MARGIN
): number {
  const overflow = viewportWidth - margin - rect.right;
  return overflow < 0 ? Math.max(overflow, margin - rect.left) : Math.max(margin - rect.left, 0);
}
