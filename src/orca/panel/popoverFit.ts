import { horizontalShift } from "./popoverShift";

/** The menu a dropdown opens: its filter field and the list are its children. */
const MENU_FIELD = "header input[role='combobox']";

function fitMenus(): void {
  for (const field of document.querySelectorAll<HTMLInputElement>(MENU_FIELD)) {
    const menu = field.parentElement;
    if (menu === null) {
      continue;
    }

    // Measure where the menu sits on its own, then move it.
    menu.style.translate = "";
    const shift = horizontalShift(menu.getBoundingClientRect(), window.innerWidth);
    if (shift !== 0) {
      menu.style.translate = `${shift}px 0`;
    }
  }
}

/**
 * Keeps the toolbar's dropdown menus inside the panel.
 *
 * Upstream anchors a menu to the right edge of its button and sizes it to its content. In a narrow
 * sidebar, with the toolbar on the left, that pushes it out past the left edge. `header.css` anchors
 * it to the left instead, and this moves it back when that runs out of the right edge, as the
 * filter narrows the list and as the panel is resized.
 */
export function installPopoverFit(): void {
  let frame = 0;
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(fitMenus);
  };

  // A menu appearing, or its list changing, is a change of children; the translate set here is a
  // change of attributes, which is not watched, so this cannot loop.
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  window.addEventListener("resize", schedule);
}
