import type { SimpleGit } from "simple-git";

import { abbrevCommit } from "@/backend/utils/string";
import { t } from "@/l10n/t";
import type { DiffInput, DiffPayload } from "@/orca/shared/protocol";

/** The empty tree: what the first commit of a repository is compared with. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/** Past this many characters the patch is cut; the viewer says so. */
export const MAX_PATCH_CHARS = 1_000_000;

function title(msg: DiffInput): string {
  const fileName = msg.newFilePath.split("/").at(-1) ?? msg.newFilePath;
  const abbrev = abbrevCommit(msg.commitHash);
  const detail =
    msg.type === "A"
      ? t("Added in {0}", abbrev)
      : msg.type === "D"
        ? t("Deleted in {0}", abbrev)
        : `${abbrev}^ ↔ ${abbrev}`;
  return `${fileName} (${detail})`;
}

/**
 * Whether the commit has a parent. `rev-list --parents` prints the commit followed by its parents;
 * `rev-parse <hash>^` would do, but exits 1 without a message for a root commit, which simple-git
 * does not treat as a failure.
 */
async function hasParent(git: SimpleGit, commitHash: string): Promise<boolean> {
  const line = await git.raw(["rev-list", "--parents", "-n", "1", commitHash]);
  return line.trim().split(/\s+/).length > 1;
}

/**
 * The patch of one file of a commit, against the commit's first parent, as the VS Code
 * extension's `vscode.diff` view showed it. `git diff` does the work, so binary files,
 * renames and mode changes come out as git reports them.
 */
export async function loadDiff(git: SimpleGit, msg: DiffInput): Promise<DiffPayload> {
  const base = (await hasParent(git, msg.commitHash)) ? `${msg.commitHash}^` : EMPTY_TREE;
  // Naming both paths lets `--find-renames` pair a renamed file's two sides.
  const paths = [...new Set([msg.oldFilePath, msg.newFilePath])];
  const output = await git.raw([
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--find-renames",
    base,
    msg.commitHash,
    "--",
    ...paths
  ]);

  const truncated = output.length > MAX_PATCH_CHARS;
  return {
    title: title(msg),
    commitHash: msg.commitHash,
    oldFilePath: msg.oldFilePath,
    newFilePath: msg.newFilePath,
    type: msg.type,
    patch: truncated ? output.slice(0, MAX_PATCH_CHARS) : output,
    truncated
  };
}
