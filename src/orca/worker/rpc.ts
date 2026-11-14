import { simpleGit } from "simple-git";

import { getWebviewLocalizedStrings } from "@/l10n/webviewL10n";
import type {
  RpcMethod,
  RpcMethodMap,
  RpcNotificationMap,
  RpcNotificationName,
  WebviewInitialize
} from "@/types";

import type { OrcaConfig } from "./config";
import { scanRepos, toGitRepo, type Workspace } from "./workspaces";

export type RpcDeps = {
  /** The current settings, read fresh. */
  config: () => Promise<OrcaConfig>;
  workspaces: () => Promise<Workspace[]>;
  focusedWorkspace: (workspaces: readonly Workspace[]) => Promise<Workspace | undefined>;
  lastActiveRepo: () => Promise<string | null>;
  notify: <N extends RpcNotificationName>(name: N, message: RpcNotificationMap[N]) => void;
  copy: (text: string) => Promise<boolean>;
};

type RpcHandlers = {
  [M in RpcMethod]: (params: unknown) => Promise<RpcMethodMap[M]["result"]>;
};

const PORTABLE_GIT_HINT =
  'If you are using a portable Git installation, set the Git Graph plugin setting "Git executable" to the path of your Git (e.g. "C:\\Program Files\\Git\\bin\\git.exe" on Windows).';

/** The neo-git-graph RPC methods (`src/extension/rpc/handlers.ts`), on Orca instead of VS Code. */
export function createRpcHandlers(deps: RpcDeps): RpcHandlers {
  return {
    "webview.initialize": async (): Promise<WebviewInitialize> => {
      const config = await deps.config();
      return {
        l10n: { ...getWebviewLocalizedStrings(), portableGitHint: PORTABLE_GIT_HINT },
        config: {
          autoCenterCommitDetailsView: config.autoCenterCommitDetailsView,
          dateFormat: config.dateFormat,
          // Avatars are deprecated upstream and not part of the Orca port.
          fetchAvatars: false,
          graphColours: config.graphColours,
          graphStyle: config.graphStyle,
          initialLoadCommits: config.initialLoadCommits,
          loadMoreCommits: config.loadMoreCommits,
          // The panel knows Orca's locale (`orca.locale`) and fills this in.
          locale: "en",
          showCurrentBranchByDefault: config.showCurrentBranchByDefault
        }
      };
    },

    "repo.scan": async () => {
      const [config, workspaces] = await Promise.all([deps.config(), deps.workspaces()]);
      const focused = await deps.focusedWorkspace(workspaces);
      const repos = await scanRepos({
        workspacePaths: workspaces.map((workspace) => workspace.path),
        gitPath: config.gitPath,
        maxDepth: config.maxDepthOfRepoSearch,
        preferred: [focused?.path, await deps.lastActiveRepo()]
      });
      return { repos };
    },

    "git.init": async () => {
      const workspaces = await deps.workspaces();
      const target = (await deps.focusedWorkspace(workspaces)) ?? workspaces[0];
      if (target === undefined) {
        throw new Error("There is no workspace to initialize a repository in.");
      }

      const config = await deps.config();
      await simpleGit({ baseDir: target.path, binary: config.gitPath }).init();
      deps.notify("repo.changed", { type: "created", repo: toGitRepo(target.path) });
      return true;
    },

    "clipboard.copy": async (params) => {
      if (typeof params !== "string") {
        throw new Error("Invalid copyToClipboard parameters");
      }
      return deps.copy(params);
    }
  };
}

export function isRpcMethod(method: string, handlers: RpcHandlers): method is RpcMethod {
  return Object.hasOwn(handlers, method);
}
