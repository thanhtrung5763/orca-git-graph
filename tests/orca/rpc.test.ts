import { beforeEach, describe, expect, it, vi } from "vitest";

import { findGitRepos } from "@/backend/queries/repoSearch";
import { DEFAULT_CONFIG } from "@/orca/worker/config";
import { createRpcHandlers, isRpcMethod, type RpcDeps } from "@/orca/worker/rpc";
import type { Workspace } from "@/orca/worker/workspaces";

const init = vi.hoisted(() => vi.fn());
vi.mock("simple-git", () => ({ simpleGit: vi.fn(() => ({ init })) }));
vi.mock("@/backend/queries/repoSearch", () => ({ findGitRepos: vi.fn() }));

const focused: Workspace = {
  id: "w1",
  kind: "worktree",
  name: "app",
  path: "/work/app",
  branch: "main",
  hostId: "local"
};

function setup(overrides: Partial<RpcDeps> = {}) {
  const deps: RpcDeps = {
    config: vi.fn().mockResolvedValue(DEFAULT_CONFIG),
    workspaces: vi.fn().mockResolvedValue([focused]),
    focusedWorkspace: vi.fn().mockResolvedValue(focused),
    lastActiveRepo: vi.fn().mockResolvedValue(null),
    notify: vi.fn(),
    copy: vi.fn().mockResolvedValue(true),
    ...overrides
  };
  return { deps, handlers: createRpcHandlers(deps) };
}

describe("createRpcHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("webview.initialize", () => {
    it("hands the webview the settings it reads, with avatars off", async () => {
      const { handlers } = setup();

      const { config } = await handlers["webview.initialize"](null);

      expect(config).toEqual({
        autoCenterCommitDetailsView: true,
        dateFormat: "Date & Time",
        fetchAvatars: false,
        graphColours: DEFAULT_CONFIG.graphColours,
        graphStyle: "rounded",
        initialLoadCommits: 300,
        loadMoreCommits: 100,
        locale: "en",
        showCurrentBranchByDefault: false
      });
    });

    it("hands the webview its strings, with the portable Git hint pointing at Orca's setting", async () => {
      const { handlers } = setup();

      const { l10n } = await handlers["webview.initialize"](null);

      expect(l10n.loadMore).toBe("Load More Commits");
      expect(l10n.portableGitHint).toContain("Git executable");
      expect(l10n.portableGitHint).not.toContain("Visual Studio Code");
    });
  });

  describe("repo.scan", () => {
    it("lists the repositories of the local workspaces, the focused one first", async () => {
      const { handlers, deps } = setup({
        workspaces: vi.fn().mockResolvedValue([{ ...focused, id: "a", path: "/work/a" }, focused])
      });
      vi.mocked(findGitRepos).mockResolvedValue(["/work/a", "/work/app"]);

      const result = await handlers["repo.scan"](null);

      expect(findGitRepos).toHaveBeenCalledWith(["/work/a", "/work/app"], "git", 0);
      expect(result.repos).toEqual([
        { name: "app", path: "/work/app" },
        { name: "a", path: "/work/a" }
      ]);
      expect(deps.config).toHaveBeenCalled();
    });

    it("falls back to the last active repository when no workspace has focus", async () => {
      const { handlers } = setup({
        focusedWorkspace: vi.fn().mockResolvedValue(undefined),
        lastActiveRepo: vi.fn().mockResolvedValue("/work/b")
      });
      vi.mocked(findGitRepos).mockResolvedValue(["/work/a", "/work/b"]);

      const { repos } = await handlers["repo.scan"](null);

      expect(repos.map((repo) => repo.path)).toEqual(["/work/b", "/work/a"]);
    });
  });

  describe("git.init", () => {
    it("initializes the focused workspace and announces the new repository", async () => {
      const { handlers, deps } = setup();

      expect(await handlers["git.init"](null)).toBe(true);

      expect(init).toHaveBeenCalledTimes(1);
      expect(deps.notify).toHaveBeenCalledWith("repo.changed", {
        type: "created",
        repo: { name: "app", path: "/work/app" }
      });
    });

    it("uses the first workspace when none has focus", async () => {
      const { handlers, deps } = setup({ focusedWorkspace: vi.fn().mockResolvedValue(undefined) });

      await handlers["git.init"](null);

      expect(deps.notify).toHaveBeenCalledWith(
        "repo.changed",
        expect.objectContaining({ type: "created" })
      );
    });

    it("fails when there is no workspace", async () => {
      const { handlers } = setup({
        workspaces: vi.fn().mockResolvedValue([]),
        focusedWorkspace: vi.fn().mockResolvedValue(undefined)
      });

      await expect(handlers["git.init"](null)).rejects.toThrow(/no workspace/);
      expect(init).not.toHaveBeenCalled();
    });
  });

  describe("clipboard.copy", () => {
    it("copies the text", async () => {
      const { handlers, deps } = setup();

      expect(await handlers["clipboard.copy"]("abc123")).toBe(true);
      expect(deps.copy).toHaveBeenCalledWith("abc123");
    });

    it("refuses anything but text", async () => {
      const { handlers, deps } = setup();

      await expect(handlers["clipboard.copy"](42)).rejects.toThrow(/Invalid/);
      expect(deps.copy).not.toHaveBeenCalled();
    });
  });

  it("knows which methods exist", () => {
    const { handlers } = setup();

    expect(isRpcMethod("repo.scan", handlers)).toBe(true);
    expect(isRpcMethod("toString", handlers)).toBe(false);
    expect(isRpcMethod("nope", handlers)).toBe(false);
  });
});
