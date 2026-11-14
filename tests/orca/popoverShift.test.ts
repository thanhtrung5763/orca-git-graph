import { describe, expect, it } from "vitest";

import { horizontalShift } from "@/orca/panel/popoverShift";

describe("horizontalShift", () => {
  it("leaves a menu that fits where it is", () => {
    expect(horizontalShift({ left: 100, right: 300 }, 500)).toBe(0);
    expect(horizontalShift({ left: 8, right: 492 }, 500)).toBe(0);
  });

  it("moves a menu left by what runs past the right edge, plus the margin", () => {
    expect(horizontalShift({ left: 300, right: 520 }, 500)).toBe(-28);
  });

  it("moves a menu right when it starts before the left edge", () => {
    expect(horizontalShift({ left: -60, right: 140 }, 500)).toBe(68);
  });

  it("never moves a menu out past the left edge to fit the right", () => {
    // 200 wide at x=20 in a 150 panel: the right edge cannot fit, the left edge stays readable.
    expect(horizontalShift({ left: 20, right: 220 }, 150)).toBe(-12);
  });

  it("keeps the left edge on screen when the menu is wider than the panel", () => {
    expect(horizontalShift({ left: 0, right: 400 }, 300)).toBe(0 + 8);
  });

  it("takes the margin as a parameter", () => {
    expect(horizontalShift({ left: 300, right: 520 }, 500, 0)).toBe(-20);
  });
});
