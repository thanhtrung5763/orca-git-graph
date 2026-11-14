import { spawn } from "node:child_process";

type Command = { command: string; args: string[] };

function candidates(platform: NodeJS.Platform): Command[] {
  switch (platform) {
    case "darwin":
      return [{ command: "pbcopy", args: [] }];
    case "win32":
      return [{ command: "clip", args: [] }];
    default:
      return [
        { command: "wl-copy", args: [] },
        { command: "xclip", args: ["-selection", "clipboard"] },
        { command: "xsel", args: ["--clipboard", "--input"] }
      ];
  }
}

function pipeTo({ command, args }: Command, text: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["pipe", "ignore", "ignore"] });
    child.once("error", () => resolve(false));
    child.once("close", (code) => resolve(code === 0));
    child.stdin.once("error", () => resolve(false));
    child.stdin.end(text);
  });
}

/**
 * Copies text with the system clipboard tool. This is the fallback for the panel, whose frame
 * copies by itself while the person's click is still fresh; a frame may not use the clipboard API.
 */
export async function copyToClipboard(
  text: string,
  platform: NodeJS.Platform = process.platform
): Promise<boolean> {
  for (const candidate of candidates(platform)) {
    // One tool at a time, in order: stop at the first that works.
    // eslint-disable-next-line no-await-in-loop
    if (await pipeTo(candidate, text)) {
      return true;
    }
  }
  return false;
}
