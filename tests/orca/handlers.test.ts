import type { SimpleGit } from "simple-git";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkoutBranch, createBranch, deleteBranch, renameBranch } from "@/backend/actions/branch";
import { commitDetails } from "@/backend/queries/commitDetails";
import { loadBranches } from "@/backend/queries/loadBranches";
import { loadCommits } from "@/backend/queries/loadCommits";
import { DEFAULT_CONFIG, type OrcaConfig } from "@/orca/worker/config";
import { createMessageHandler } from "@/orca/worker/handlers";
import type { RequestMessage } from "@/types";

vi.mock("@/backend/actions/branch", () => ({
  checkoutBranch: vi.fn(),
  createBranch: vi.fn(),
  deleteBranch: vi.fn(),
  renameBranch: vi.fn()
}));
vi.mock("@/backend/actions/commit", () => ({
  checkoutCommit: vi.fn(),
  cherrypickCommit: vi.fn(),
  resetToCommit: vi.fn(),
  revertCommit: vi.fn()
}));
vi.mock("@/backend/actions/merge", () => ({ mergeBranch: vi.fn(), mergeCommit: vi.fn() }));
vi.mock("@/backend/actions/tag", () => ({ addTag: vi.fn(), deleteTag: vi.fn(), pushTag: vi.fn() }));
vi.mock("@/backend/queries/commitDetails", () => ({ commitDetails: vi.fn() }));
vi.mock("@/backend/queries/loadBranches", () => ({ loadBranches: vi.fn() }));
vi.mock("@/backend/queries/loadCommits", () => ({ loadCommits: vi.fn() }));

const git = { id: "git" } as unknown as SimpleGit;

function setup(config: OrcaConfig = DEFAULT_CONFIG) {
  const gitClient = { getInstance: vi.fn(() => git), setRepo: vi.fn(), setGitPath: vi.fn() };
  const state = {
    getLastActiveRepo: vi.fn(),
    setLastActiveRepo: vi.fn().mockResolvedValue(undefined),
    setRepoState: vi.fn().mockResolvedValue(undefined)
  };
  const onRepoSelected = vi.fn();
  let current = config;
  const handler = createMessageHandler({
    config: () => current,
    gitClient: gitClient as never,
    state,
    onRepoSelected
  });
  return {
    handler,
    gitClient,
    state,
    onRepoSelected,
    setConfig: (next: OrcaConfig) => {
      current = next;
    }
  };
}

describe("createMessageHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("actions", () => {
    it("runs the action with the git instance and answers with a null status", async () => {
      const { handler } = setup();
      const msg: RequestMessage = {
        command: "createBranch",
        repo: "/repo",
        commitHash: "abc",
        branchName: "feature"
      };

      expect(await handler.handle(msg)).toEqual([{ command: "createBranch", status: null }]);
      expect(createBranch).toHaveBeenCalledWith(git, msg);
    });

    it.each([
      ["checkoutBranch", checkoutBranch],
      ["deleteBranch", deleteBranch],
      ["renameBranch", renameBranch]
    ] as const)("answers %s with the git error as its status", async (command, action) => {
      const { handler } = setup();
      vi.mocked(action).mockRejectedValue(new Error("fatal: nope"));

      const [response] = await handler.handle({ command, repo: "/repo" } as RequestMessage);

      expect(response).toEqual({ command, status: "fatal: nope" });
    });

    it("answers with the text of anything that is thrown", async () => {
      const { handler } = setup();
      vi.mocked(createBranch).mockRejectedValue("plain string");

      const [response] = await handler.handle({
        command: "createBranch",
        repo: "/r"
      } as RequestMessage);

      expect(response).toEqual({ command: "createBranch", status: "plain string" });
    });
  });

  describe("queries", () => {
    it("loads commits with the person's settings and echoes the request", async () => {
      const { handler } = setup({
        ...DEFAULT_CONFIG,
        dateType: "Commit Date",
        showUncommittedChanges: false
      });
      vi.mocked(loadCommits).mockResolvedValue({
        commits: [],
        head: null,
        moreCommitsAvailable: false,
        hard: true,
        uncommittedChanges: 0
      });

      const response = await handler.handle({
        command: "loadCommits",
        repo: "/repo",
        branchName: "main",
        maxCommits: 50,
        showRemoteBranches: true,
        hard: true
      });

      expect(loadCommits).toHaveBeenCalledWith(git, {
        branchName: "main",
        maxCommits: 50,
        showRemoteBranches: true,
        hard: true,
        dateType: "Commit Date",
        showUncommittedChanges: false
      });
      expect(response).toEqual([
        expect.objectContaining({ command: "loadCommits", repo: "/repo", branchName: "main" })
      ]);
    });

    it("loads branches with the configured git", async () => {
      const { handler } = setup({ ...DEFAULT_CONFIG, gitPath: "/opt/git" });
      vi.mocked(loadBranches).mockResolvedValue({
        repo: "/repo",
        branches: ["main"],
        head: "main",
        hard: false,
        isRepo: true
      });

      const response = await handler.handle({
        command: "loadBranches",
        repo: "/repo",
        showRemoteBranches: false,
        hard: false
      });

      expect(loadBranches).toHaveBeenCalledWith(git, {
        showRemoteBranches: false,
        hard: false,
        repo: "/repo",
        gitPath: "/opt/git"
      });
      expect(response).toEqual([
        {
          command: "loadBranches",
          repo: "/repo",
          branches: ["main"],
          head: "main",
          hard: false,
          isRepo: true
        }
      ]);
    });

    it("loads commit details with the date type", async () => {
      const { handler } = setup({ ...DEFAULT_CONFIG, dateType: "Commit Date" });
      vi.mocked(commitDetails).mockResolvedValue({ commitDetails: null });

      const response = await handler.handle({
        command: "commitDetails",
        repo: "/repo",
        commitHash: "abc"
      });

      expect(commitDetails).toHaveBeenCalledWith(git, {
        commitHash: "abc",
        dateType: "Commit Date"
      });
      expect(response).toEqual([{ command: "commitDetails", commitDetails: null }]);
    });
  });

  describe("the selected repository", () => {
    it("points git at it once, remembers it and tells the watcher", async () => {
      const { handler, gitClient, state, onRepoSelected } = setup();
      vi.mocked(loadBranches).mockResolvedValue({
        repo: "/repo",
        branches: [],
        head: null,
        hard: false,
        isRepo: true
      });
      const load = {
        command: "loadBranches",
        repo: "/repo",
        showRemoteBranches: true,
        hard: false
      } as const;

      await handler.handle(load);
      await handler.handle(load);

      expect(gitClient.setRepo).toHaveBeenCalledTimes(1);
      expect(gitClient.setRepo).toHaveBeenCalledWith("/repo");
      expect(state.setLastActiveRepo).toHaveBeenCalledTimes(1);
      expect(state.setLastActiveRepo).toHaveBeenCalledWith("/repo");
      expect(onRepoSelected).toHaveBeenCalledTimes(1);
      expect(onRepoSelected).toHaveBeenCalledWith("/repo");
    });

    it("follows the repository named by any message, as after the worker restarted", async () => {
      const { handler, gitClient, onRepoSelected } = setup();
      vi.mocked(commitDetails).mockResolvedValue({ commitDetails: null });

      await handler.handle({ command: "commitDetails", repo: "/shown", commitHash: "abc" });
      await handler.handle({ command: "deleteTag", repo: "/shown", tagName: "v1" });
      await handler.handle({ command: "deleteTag", repo: "/other", tagName: "v1" });

      expect(gitClient.setRepo.mock.calls.map(([repo]) => repo)).toEqual(["/shown", "/other"]);
      expect(onRepoSelected.mock.calls.map(([repo]) => repo)).toEqual(["/shown", "/other"]);
    });

    it("reports a repository that cannot be opened as the action's status", async () => {
      const { handler, gitClient } = setup();
      gitClient.setRepo.mockImplementation(() => {
        throw new Error("Cannot use simple-git on a directory that does not exist");
      });

      const [response] = await handler.handle({
        command: "deleteTag",
        repo: "/gone",
        tagName: "v1"
      });

      expect(response).toEqual({
        command: "deleteTag",
        status: "Cannot use simple-git on a directory that does not exist"
      });
    });

    it("switches on selectRepo, and again after reset", async () => {
      const { handler, gitClient } = setup();

      expect(await handler.handle({ command: "selectRepo", repo: "/one" })).toEqual([]);
      await handler.handle({ command: "selectRepo", repo: "/two" });
      handler.reset();
      await handler.handle({ command: "selectRepo", repo: "/two" });

      expect(gitClient.setRepo.mock.calls.map(([repo]) => repo)).toEqual(["/one", "/two", "/two"]);
    });

    it("follows a change of the Git executable", async () => {
      const { handler, gitClient, setConfig } = setup();

      await handler.handle({ command: "selectRepo", repo: "/repo" });
      expect(gitClient.setGitPath).not.toHaveBeenCalled();

      setConfig({ ...DEFAULT_CONFIG, gitPath: "/opt/git" });
      vi.mocked(commitDetails).mockResolvedValue({ commitDetails: null });
      await handler.handle({ command: "commitDetails", repo: "/repo", commitHash: "abc" });

      expect(gitClient.setGitPath).toHaveBeenCalledWith("/opt/git");
    });
  });

  describe("infrastructure messages", () => {
    it("stores the repository state", async () => {
      const { handler, state } = setup();
      const repoState = { columnWidths: [10, 20, 30, 40] };

      expect(
        await handler.handle({ command: "saveRepoState", repo: "/repo", state: repoState })
      ).toEqual([]);
      expect(state.setRepoState).toHaveBeenCalledWith("/repo", repoState);
    });

    it("answers nothing for avatars, which this port leaves out", async () => {
      const { handler } = setup();

      expect(
        await handler.handle({ command: "fetchAvatar", repo: "/r", email: "a@b.c", commits: [] })
      ).toEqual([]);
    });
  });
});
