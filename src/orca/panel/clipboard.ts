/**
 * Copies text from inside the frame. Plugin frames deny the async clipboard API, but
 * `document.execCommand("copy")` works while the person's click is still a user gesture.
 */
export function copyText(text: string): boolean {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  Object.assign(area.style, {
    position: "fixed",
    top: "0",
    left: "0",
    opacity: "0",
    pointerEvents: "none"
  });
  document.body.append(area);
  area.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
    previous?.focus();
  }
}
