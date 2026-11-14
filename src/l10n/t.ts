/**
 * Fills the placeholders of a message: `{0}` is the first argument, `{1}` the second. A placeholder
 * with no argument is left as it is, which is how the strings the webview fills in itself reach it.
 */
export function t(message: string, ...args: readonly unknown[]): string {
  return message.replace(/\{(\d+)\}/g, (placeholder, index: string) => {
    const value = args[Number(index)];
    return value === undefined ? placeholder : String(value);
  });
}
