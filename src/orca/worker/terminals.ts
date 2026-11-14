import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** One row of `orca terminal list --json`, narrowed to what this needs. */
export type TerminalRow = { handle?: unknown; worktreePath?: unknown };

/**
 * The workspace of the focused workspace, from the ids of its terminals.
 *
 * Orca 1.4.x reports a focus change by display name and branch only, and a worktree name such as
 * `main` or `develop` is shared by several projects. Orca's own terminal list names each terminal's
 * worktree, so the terminal ids in the focus context identify the workspace exactly. Newer Orca
 * versions name the workspace directly and never reach this.
 */
export async function findWorkspacePathForTerminals(
  terminalIds: readonly string[],
  listTerminals: () => Promise<readonly TerminalRow[]> = listTerminalsFromOrca
): Promise<string | undefined> {
  if (terminalIds.length === 0) {
    return undefined;
  }

  let terminals: readonly TerminalRow[];
  try {
    terminals = await listTerminals();
  } catch {
    return undefined;
  }

  const wanted = new Set(terminalIds);
  const match = terminals.find(
    (terminal) => typeof terminal.handle === "string" && wanted.has(terminal.handle)
  );
  return typeof match?.worktreePath === "string" ? match.worktreePath : undefined;
}

/** The terminals of this Orca, through its CLI. An absent CLI just means no answer. */
async function listTerminalsFromOrca(): Promise<readonly TerminalRow[]> {
  for (const binary of cliCandidates()) {
    try {
      // eslint-disable-next-line no-await-in-loop -- try each path in turn, stopping at the first
      const { stdout } = await execFileAsync(binary, ["terminal", "list", "--json"], {
        timeout: 5000,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true
      });
      const parsed = JSON.parse(stdout) as { result?: { terminals?: unknown } };
      if (Array.isArray(parsed.result?.terminals)) {
        return parsed.result.terminals as TerminalRow[];
      }
    } catch {
      // Try the next path; the CLI may be somewhere else, or Orca may be shutting down.
    }
  }
  return [];
}

/** Orca's own CLI first, then whatever `orca` is on the worker's `PATH`. */
function cliCandidates(): string[] {
  const resources = (process as { resourcesPath?: unknown }).resourcesPath;
  if (typeof resources !== "string") {
    return ["orca"];
  }

  const names = process.platform === "win32" ? ["orca.exe", "orca.cmd"] : ["orca"];
  const local = names
    .map((name) => path.join(resources, "bin", name))
    .filter((candidate) => fs.existsSync(candidate));
  return [...local, "orca"];
}
