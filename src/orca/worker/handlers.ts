import type { SimpleGit } from "simple-git";

import { checkoutBranch, createBranch, deleteBranch, renameBranch } from "@/backend/actions/branch";
import {
  checkoutCommit,
  cherrypickCommit,
  resetToCommit,
  revertCommit
} from "@/backend/actions/commit";
import { mergeBranch, mergeCommit } from "@/backend/actions/merge";
import { addTag, deleteTag, pushTag } from "@/backend/actions/tag";
import type { GitClient } from "@/backend/gitClient";
import { commitDetails } from "@/backend/queries/commitDetails";
import { loadBranches } from "@/backend/queries/loadBranches";
import { loadCommits } from "@/backend/queries/loadCommits";
import type { ActionRequest } from "@/backend/types";
import { isActionCommand } from "@/orca/shared/protocol";
import type { RequestMessage, ResponseMessage } from "@/types";

import type { OrcaConfig } from "./config";
import type { StateStore } from "./state";

type Actions = {
  [K in ActionRequest["command"]]: (
    git: SimpleGit,
    msg: Extract<ActionRequest, { command: K }>
  ) => Promise<void>;
};

const ACTIONS: Actions = {
  addTag,
  deleteTag,
  pushTag,
  createBranch,
  deleteBranch,
  renameBranch,
  checkoutBranch,
  checkoutCommit,
  cherrypickCommit,
  revertCommit,
  resetToCommit,
  mergeBranch,
  mergeCommit
};

export type MessageHandlerDeps = {
  config: () => OrcaConfig;
  gitClient: GitClient;
  state: Pick<StateStore, "setLastActiveRepo" | "setRepoState">;
  /** Called with the repository the person works in, so it can be watched for changes. */
  onRepoSelected: (repo: string) => void;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Answers the webview's `{ command }` messages. This is the VS Code extension's `messageHandler.ts` without
 * the VS Code parts: it returns the responses instead of posting them.
 */
export function createMessageHandler(deps: MessageHandlerDeps) {
  const { config, gitClient, state, onRepoSelected } = deps;
  let currentRepo: string | null = null;
  let currentGitPath = config().gitPath;

  function git(): SimpleGit {
    const { gitPath } = config();
    if (gitPath !== currentGitPath) {
      currentGitPath = gitPath;
      gitClient.setGitPath(gitPath);
    }
    return gitClient.getInstance();
  }

  /**
   * Points git at the repository a message is about. The VS Code extension only did this for
   * `loadCommits` and `loadBranches` and relied on one of them having run. Orca stops an idle
   * worker, and the panel then goes on with the repository it already shows, so every message
   * names its repository and the worker follows it.
   */
  function setCurrentRepo(repo: string): void {
    if (repo === currentRepo || repo === "") {
      return;
    }
    gitClient.setRepo(repo);
    currentRepo = repo;
    void state.setLastActiveRepo(repo);
    onRepoSelected(repo);
  }

  async function runAction(msg: ActionRequest): Promise<ResponseMessage> {
    let status: string | null = null;
    try {
      setCurrentRepo(msg.repo);
      // `msg.command` and `msg` are correlated, which the index type cannot express.
      const run = ACTIONS[msg.command] as (git: SimpleGit, msg: ActionRequest) => Promise<void>;
      await run(git(), msg);
    } catch (error) {
      status = errorMessage(error);
    }
    return { command: msg.command, status } as ResponseMessage;
  }

  return {
    /** Forgets the selected repository, as when the panel is shown again. */
    reset(): void {
      currentRepo = null;
    },

    async handle(msg: RequestMessage): Promise<ResponseMessage[]> {
      if (isActionCommand(msg.command)) {
        return [await runAction(msg as ActionRequest)];
      }

      setCurrentRepo(msg.repo);

      switch (msg.command) {
        case "loadCommits": {
          const settings = config();
          const result = await loadCommits(git(), {
            branchName: msg.branchName,
            maxCommits: msg.maxCommits,
            showRemoteBranches: msg.showRemoteBranches,
            hard: msg.hard,
            dateType: settings.dateType,
            showUncommittedChanges: settings.showUncommittedChanges
          });
          return [
            { command: "loadCommits", repo: msg.repo, branchName: msg.branchName, ...result }
          ];
        }
        case "loadBranches": {
          const result = await loadBranches(git(), {
            showRemoteBranches: msg.showRemoteBranches,
            hard: msg.hard,
            repo: msg.repo,
            gitPath: config().gitPath
          });
          return [{ command: "loadBranches", ...result }];
        }
        case "commitDetails": {
          const result = await commitDetails(git(), {
            commitHash: msg.commitHash,
            dateType: config().dateType
          });
          return [{ command: "commitDetails", ...result }];
        }
        case "selectRepo":
          return [];
        case "saveRepoState":
          await state.setRepoState(msg.repo, msg.state);
          return [];
        // Avatars are deprecated upstream and need network access the worker does not set up;
        // `viewDiff` has its own request (`gg.diff`).
        case "fetchAvatar":
        case "viewDiff":
          return [];
      }
    }
  };
}

export type MessageHandler = ReturnType<typeof createMessageHandler>;
