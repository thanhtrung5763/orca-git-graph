import type { GitRepo } from "@/types";

/** Forward slashes and no trailing slash, so a path from Orca and one from git compare equal. */
function normalise(path: string): string {
  const forward = path.replaceAll("\\", "/");
  if (forward.length <= 1 || /^[A-Za-z]:\/$/.test(forward)) {
    return forward;
  }
  return forward.replace(/\/+$/, "");
}

/**
 * The repository a focused workspace shows. The workspace is usually the repository itself; when
 * the repository search depth is above zero it can instead be a folder holding repositories, and
 * then the closest one wins.
 */
export function findRepoForWorkspace(
  workspacePath: string,
  repos: readonly GitRepo[]
): string | undefined {
  const wanted = normalise(workspacePath);
  const exact = repos.find((repo) => normalise(repo.path) === wanted);
  if (exact !== undefined) {
    return exact.path;
  }

  const prefix = wanted.endsWith("/") ? wanted : `${wanted}/`;
  const nested = repos
    .map((repo) => ({ repo, path: normalise(repo.path) }))
    .filter(({ path }) => path.startsWith(prefix))
    .map(({ repo, path }) => ({ repo, path, depth: path.slice(prefix.length).split("/").length }))
    .toSorted((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));
  return nested[0]?.repo.path;
}
