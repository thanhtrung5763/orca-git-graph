import { beforeEach, describe, expect, it, vi } from "vitest";

import { findGitRepos } from "@/backend/queries/repoSearch";
import { findWorkspacePathForTerminals } from "@/orca/worker/terminals";
import {
  exactFocusedWorkspace,
  findFocusedWorkspace,
  listLocalWorkspaces,
  matchUniqueFocusedWorkspace,
  scanRepos,
  toGitRepo,
  type Workspace
} from "@/orca/worker/workspaces";

vi.mock("@/backend/queries/repoSearch", () => ({ findGitRepos: vi.fn() }));
vi.mock("@/orca/worker/terminals", () => ({ findWorkspacePathForTerminals: vi.fn() }));

function workspace(overrides: Partial<Workspace> & { id: string }): Workspace {
  return {
    kind: "worktree",
    name: overrides.id,
    path: `/work/${overrides.id}`,
    branch: "main",
    hostId: "local",
    ...overrides
  };
}

describe("listLocalWorkspaces", () => {
  it("keeps workspaces on this machine and drops those on other hosts", async () => {
    const host = {
      call: vi.fn().mockResolvedValue({
        workspaces: [
          workspace({ id: "a", hostId: "local" }),
          workspace({ id: "b", hostId: null }),
          workspace({ id: "c", hostId: "ssh:box" }),
          workspace({ id: "d", hostId: "runtime:x" })
        ]
      })
    };

    const result = await listLocalWorkspaces(host);

    expect(host.call).toHaveBeenCalledWith("workspace.list", {});
    expect(result.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("answers an empty list when Orca returns nothing", async () => {
    expect(await listLocalWorkspaces({ call: vi.fn().mockResolvedValue(null) })).toEqual([]);
  });
});

describe("findFocusedWorkspace", () => {
  const workspaces = [
    workspace({ id: "a", name: "alpha", branch: "main" }),
    workspace({ id: "b", name: "beta", branch: "feature" })
  ];

  it("finds the workspace by id", async () => {
    const host = {
      call: vi.fn().mockResolvedValue({ workspaceId: "b", branch: "x", displayName: "x" })
    };
    expect((await findFocusedWorkspace(host, workspaces))?.id).toBe("b");
  });

  it("falls back to the display name and branch when the ids differ", async () => {
    const host = {
      call: vi
        .fn()
        .mockResolvedValue({ workspaceId: "other-id", branch: "feature", displayName: "beta" })
    };
    expect((await findFocusedWorkspace(host, workspaces))?.id).toBe("b");
  });

  it("finds nothing when no workspace has focus or the lookup fails", async () => {
    expect(
      await findFocusedWorkspace({ call: vi.fn().mockResolvedValue(null) }, workspaces)
    ).toBeUndefined();
    expect(
      await findFocusedWorkspace({ call: vi.fn().mockRejectedValue(new Error("no")) }, workspaces)
    ).toBeUndefined();
  });
});

describe("exactFocusedWorkspace", () => {
  const workspaces = [
    workspace({ id: "a", name: "main", branch: "main", path: "/work/a" }),
    workspace({ id: "b", name: "main", branch: "main", path: "/work/b" }),
    workspace({ id: "c", name: "feature", branch: "feature", path: "/work/c" })
  ];

  beforeEach(() => {
    vi.mocked(findWorkspacePathForTerminals).mockReset().mockResolvedValue(undefined);
  });

  it("uses the id when Orca provides one, without asking the CLI", async () => {
    const context = { workspaceId: "b", branch: "main", displayName: "main" };

    expect((await exactFocusedWorkspace(context, workspaces))?.path).toBe("/work/b");
    expect(findWorkspacePathForTerminals).not.toHaveBeenCalled();
  });

  it("finds the workspace by its terminals when name and branch collide", async () => {
    vi.mocked(findWorkspacePathForTerminals).mockResolvedValue("/work/b");

    const context = {
      branch: "main",
      displayName: "main",
      terminals: [{ id: "term_x" }]
    };
    expect((await exactFocusedWorkspace(context, workspaces))?.path).toBe("/work/b");
    expect(findWorkspacePathForTerminals).toHaveBeenCalledWith(["term_x"]);
  });

  it("answers nothing rather than guessing when name and branch collide", async () => {
    const context = { branch: "main", displayName: "main", terminals: [{ id: "term_x" }] };

    expect(await exactFocusedWorkspace(context, workspaces)).toBeUndefined();
    expect(await exactFocusedWorkspace(null, workspaces)).toBeUndefined();
  });
});

describe("matchUniqueFocusedWorkspace", () => {
  const workspaces = [
    workspace({ id: "a", name: "main", branch: "main", path: "/work/a" }),
    workspace({ id: "b", name: "main", branch: "main", path: "/work/b" }),
    workspace({ id: "c", name: "feature", branch: "feature", path: "/work/c" })
  ];

  it("uses the id when Orca gives one, even beside workspaces sharing name and branch", () => {
    expect(
      matchUniqueFocusedWorkspace(
        { workspaceId: "b", branch: "main", displayName: "main" },
        workspaces
      )?.path
    ).toBe("/work/b");
  });

  it("uses name and branch when they name one workspace", () => {
    expect(
      matchUniqueFocusedWorkspace({ branch: "feature", displayName: "feature" }, workspaces)?.path
    ).toBe("/work/c");
  });

  it("refuses to guess between workspaces that share name and branch", () => {
    expect(
      matchUniqueFocusedWorkspace({ branch: "main", displayName: "main" }, workspaces)
    ).toBeUndefined();
    expect(matchUniqueFocusedWorkspace(null, workspaces)).toBeUndefined();
  });
});

describe("toGitRepo", () => {
  it("names a repository after its folder and uses forward slashes", () => {
    expect(toGitRepo("/work/app")).toEqual({ name: "app", path: "/work/app" });
    expect(toGitRepo("C:\\work\\app")).toEqual({
      name: "C:\\work\\app".split("\\").pop(),
      path: "C:/work/app"
    });
  });
});

describe("scanRepos", () => {
  beforeEach(() => {
    vi.mocked(findGitRepos).mockReset();
  });

  it("searches the workspace folders with the configured depth and git", async () => {
    vi.mocked(findGitRepos).mockResolvedValue([]);

    await scanRepos({
      workspacePaths: ["/a", "/b"],
      gitPath: "/bin/git",
      maxDepth: 2,
      preferred: []
    });

    expect(findGitRepos).toHaveBeenCalledWith(["/a", "/b"], "/bin/git", 2);
  });

  it("sorts by path and drops duplicates", async () => {
    vi.mocked(findGitRepos).mockResolvedValue(["/w/b", "/w/a", "/w/b"]);

    const repos = await scanRepos({
      workspacePaths: [],
      gitPath: "git",
      maxDepth: 0,
      preferred: []
    });

    expect(repos.map((repo) => repo.path)).toEqual(["/w/a", "/w/b"]);
  });

  it("lists the preferred repository first, trying the preferences in order", async () => {
    vi.mocked(findGitRepos).mockResolvedValue(["/w/a", "/w/b", "/w/c"]);

    const focused = await scanRepos({
      workspacePaths: [],
      gitPath: "git",
      maxDepth: 0,
      preferred: ["/w/c", "/w/b"]
    });
    expect(focused.map((repo) => repo.path)).toEqual(["/w/c", "/w/a", "/w/b"]);

    const fallback = await scanRepos({
      workspacePaths: [],
      gitPath: "git",
      maxDepth: 0,
      preferred: [undefined, "/w/elsewhere", "/w/b"]
    });
    expect(fallback.map((repo) => repo.path)).toEqual(["/w/b", "/w/a", "/w/c"]);
  });

  it("keeps the order when no preference matches", async () => {
    vi.mocked(findGitRepos).mockResolvedValue(["/w/a", "/w/b"]);

    const repos = await scanRepos({
      workspacePaths: [],
      gitPath: "git",
      maxDepth: 0,
      preferred: [null, "/nowhere"]
    });

    expect(repos.map((repo) => repo.path)).toEqual(["/w/a", "/w/b"]);
  });
});
