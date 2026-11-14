import path from "node:path";

import { findGitRepos } from "@/backend/queries/repoSearch";
import { getPathFromStr } from "@/backend/utils/path";
import type { GitRepo } from "@/types";

import { findWorkspacePathForTerminals } from "./terminals";

export type Workspace = {
  id: string;
  kind: "worktree" | "folder";
  name: string;
  path: string;
  branch: string | null;
  hostId: string | null;
};

type HostCaller = { call(method: string, params?: unknown): Promise<unknown> };

/** What `workspace.readContext` answers, and the `context` of a `workspace.changed` event. */
export type FocusedContext = {
  workspaceId?: string;
  branch: string;
  displayName: string;
  terminals?: { id: string }[];
} | null;

/**
 * Workspaces on this machine. The worker runs `git` and reads files locally, so a workspace on an
 * SSH or runtime host (`hostId` like `ssh:...`) is out of reach. A `null` host is a folder Orca
 * records no host for, which lives on this machine.
 */
export async function listLocalWorkspaces(host: HostCaller): Promise<Workspace[]> {
  const result = (await host.call("workspace.list", {})) as { workspaces?: Workspace[] } | null;
  return (result?.workspaces ?? []).filter(
    (workspace) => workspace.hostId === null || workspace.hostId === "local"
  );
}

/** The workspaces a focus context can name. */
function focusedCandidates(context: FocusedContext, workspaces: readonly Workspace[]): Workspace[] {
  if (context === null) {
    return [];
  }

  const byId = workspaces.filter((workspace) => workspace.id === context.workspaceId);
  if (byId.length > 0) {
    return byId;
  }
  return workspaces.filter(
    (workspace) => workspace.name === context.displayName && workspace.branch === context.branch
  );
}

/**
 * The workspace a focus context names, taking the first when Orca names one by fields several
 * workspaces share. `workspaceId` should be the id `workspace.list` gives; when it is not, fall back
 * to the display name and branch.
 */
export function matchFocusedWorkspace(
  context: FocusedContext,
  workspaces: readonly Workspace[]
): Workspace | undefined {
  return focusedCandidates(context, workspaces)[0];
}

/**
 * The workspace a focus context names, only when it names exactly one. Orca 1.4.x reports a focus
 * change by display name and branch alone, and every `main` worktree is `main`/`main`: switching
 * between those must not move the panel to whichever one happens to come first.
 */
export function matchUniqueFocusedWorkspace(
  context: FocusedContext,
  workspaces: readonly Workspace[]
): Workspace | undefined {
  const candidates = focusedCandidates(context, workspaces);
  return candidates.length === 1 ? candidates[0] : undefined;
}

/**
 * The workspace a focus context names, without guessing. Orca 1.4.x names a workspace by fields
 * several worktrees share; its terminals do name it, so ask the CLI which workspace holds them.
 */
export async function exactFocusedWorkspace(
  context: FocusedContext,
  workspaces: readonly Workspace[]
): Promise<Workspace | undefined> {
  const unique = matchUniqueFocusedWorkspace(context, workspaces);
  if (unique !== undefined || context === null) {
    return unique;
  }

  const terminalPath = await findWorkspacePathForTerminals(
    (context.terminals ?? []).map(({ id }) => id)
  );
  if (terminalPath === undefined) {
    return undefined;
  }

  const wanted = getPathFromStr(terminalPath);
  return workspaces.find((workspace) => getPathFromStr(workspace.path) === wanted);
}

/** The workspace that has focus in Orca, falling back to the first plausible one. */
export async function findFocusedWorkspace(
  host: HostCaller,
  workspaces: readonly Workspace[]
): Promise<Workspace | undefined> {
  const context = (await host
    .call("workspace.readContext", {})
    .catch(() => null)) as FocusedContext;
  return (
    (await exactFocusedWorkspace(context, workspaces)) ?? matchFocusedWorkspace(context, workspaces)
  );
}

export function toGitRepo(repoPath: string): GitRepo {
  const normalised = getPathFromStr(repoPath);
  return { name: path.basename(normalised), path: normalised };
}

/**
 * Finds the Git repositories in the workspaces. `preferred` (the focused workspace, else the last
 * active repository) is listed first because the webview opens the first repository.
 */
export async function scanRepos(input: {
  workspacePaths: readonly string[];
  gitPath: string;
  maxDepth: number;
  preferred: readonly (string | null | undefined)[];
}): Promise<GitRepo[]> {
  const found = await findGitRepos([...input.workspacePaths], input.gitPath, input.maxDepth);
  const repos = [...new Set(found.map((repoPath) => getPathFromStr(repoPath)))]
    .toSorted((a, b) => a.localeCompare(b))
    .map(toGitRepo);

  for (const wanted of input.preferred) {
    const normalised = wanted === null || wanted === undefined ? null : getPathFromStr(wanted);
    const index = repos.findIndex((repo) => repo.path === normalised);
    if (index > 0) {
      const [repo] = repos.splice(index, 1);
      if (repo !== undefined) {
        repos.unshift(repo);
      }
      break;
    }
    if (index === 0) {
      break;
    }
  }

  return repos;
}
