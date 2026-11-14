import { simpleGit } from "simple-git";

import { gitClientFactory } from "@/backend/gitClient";
import { isGitRepository } from "@/backend/utils/git";
import { getPathFromStr } from "@/backend/utils/path";
import {
  EVENT_FOCUS_REPO,
  EVENT_NOTIFY,
  type Answer,
  type DiffInput,
  type DiffOutput,
  type FetchInput,
  type FetchOutput,
  type FocusRepoEvent,
  type MsgOutput,
  type NotifyEvent,
  type RpcOutput
} from "@/orca/shared/protocol";
import type { OrcaWorkerApi } from "@/orca/types/orca-api";
import type { RequestMessage, RpcNotificationMap, RpcNotificationName } from "@/types";

import { createChunkStore } from "./chunks";
import { copyToClipboard } from "./clipboard";
import {
  createCommitGraphWriter,
  fileExists,
  gitRunner,
  type CommitGraphWriter
} from "./commitGraph";
import { DEFAULT_CONFIG, parseConfig, type OrcaConfig } from "./config";
import { loadDiff } from "./diff";
import { createMessageHandler } from "./handlers";
import { createRpcHandlers, isRpcMethod } from "./rpc";
import { createStateStore } from "./state";
import { createRepoWatcher } from "./watcher";
import {
  exactFocusedWorkspace,
  findFocusedWorkspace,
  listLocalWorkspaces,
  toGitRepo,
  type FocusedContext
} from "./workspaces";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Everything the worker does, built on one `orca` object so tests can hand it a fake.
 * `main.ts` registers these methods as the panel's request handlers.
 */
export function createRuntime(
  orca: OrcaWorkerApi,
  overrides: { commitGraph?: CommitGraphWriter } = {}
) {
  let config: OrcaConfig = DEFAULT_CONFIG;
  /**
   * Whether Orca has reported a focus yet. The first report is the workspace already focused when
   * the worker starts, which the panel has just scanned and opened on: a baseline, not a move.
   */
  let focusReported = false;
  /** The path of the workspace last found to be focused, to tell a move from a terminal change. */
  let focusedPath: string | undefined;
  /** Numbers the reports, so a slow answer about an older one is dropped. */
  let focusSequence = 0;

  const state = createStateStore(orca.storage);
  const chunks = createChunkStore();
  const gitClient = gitClientFactory("", config.gitPath);

  function notify<N extends RpcNotificationName>(name: N, message: RpcNotificationMap[N]): void {
    orca.panels.post(EVENT_NOTIFY, { name, message } as NotifyEvent<N>);
  }

  async function refreshConfig(): Promise<OrcaConfig> {
    const result = (await orca.host.call("settings.get", {}).catch(() => null)) as {
      settings?: Record<string, unknown>;
    } | null;
    config = parseConfig(result?.settings ?? {});
    return config;
  }

  const commitGraph =
    overrides.commitGraph ??
    createCommitGraphWriter(
      {
        git: gitRunner(() => config.gitPath),
        exists: fileExists,
        now: Date.now,
        loadFailures: () => state.getCommitGraphFailures(),
        saveFailure: (repo, at) => state.setCommitGraphFailure(repo, at),
        log: (message) => orca.log(message)
      },
      () => config.writeCommitGraph
    );

  const watcher = createRepoWatcher({
    onUpdate: (path) => notify("repo.updated", { path }),
    onError: (message) => orca.log(message)
  });

  const messages = createMessageHandler({
    config: () => config,
    gitClient,
    state,
    onRepoSelected: (repo) => watcher.select(repo)
  });

  const rpcHandlers = createRpcHandlers({
    config: refreshConfig,
    workspaces: () => listLocalWorkspaces(orca.host),
    focusedWorkspace: (workspaces) => findFocusedWorkspace(orca.host, workspaces),
    lastActiveRepo: () => state.getLastActiveRepo(),
    notify,
    copy: copyToClipboard
  });

  return {
    async init(): Promise<void> {
      await refreshConfig();
    },

    refreshConfig,

    async handleRpc(input: unknown): Promise<Answer<RpcOutput>> {
      const method = isRecord(input) && typeof input["method"] === "string" ? input["method"] : "";
      const params = isRecord(input) ? input["params"] : undefined;

      let output: RpcOutput;
      if (!isRpcMethod(method, rpcHandlers)) {
        output = { ok: false, error: `Unknown RPC method: ${method}` };
      } else {
        try {
          output = { ok: true, result: await rpcHandlers[method](params) };
        } catch (error) {
          orca.log(`RPC ${method} failed: ${errorMessage(error)}`);
          output = { ok: false, error: errorMessage(error) };
        }
      }
      return chunks.wrap(output);
    },

    async handleMessage(input: unknown): Promise<Answer<MsgOutput>> {
      if (!isRecord(input) || typeof input["command"] !== "string") {
        throw new Error("Invalid message");
      }

      // Settings can change between requests (the person edits them in Orca's Settings).
      await refreshConfig();

      // The request's own file changes (a checkout rewrites the index) are not news.
      watcher.mute();
      try {
        const started = performance.now();
        const responses = await messages.handle(input as RequestMessage);
        if (input["command"] === "loadCommits" && typeof input["repo"] === "string") {
          // A slow log is the sign of a repository a commit-graph would help; this runs behind the answer.
          void commitGraph
            .consider(input["repo"], performance.now() - started)
            .catch(() => undefined);
        }
        return chunks.wrap({ messages: responses });
      } finally {
        watcher.unmute();
      }
    },

    async handleDiff(input: unknown): Promise<Answer<DiffOutput>> {
      if (!isRecord(input) || typeof input["repo"] !== "string") {
        throw new Error("Invalid diff request");
      }

      const request = input as DiffInput;
      try {
        // A separate instance: `cwd()` on the shared one would move every later request.
        const git = simpleGit({ baseDir: request.repo, binary: config.gitPath });
        return chunks.wrap({ ok: true, diff: await loadDiff(git, request) });
      } catch (error) {
        orca.log(`Cannot diff ${request.newFilePath}: ${errorMessage(error)}`);
        return chunks.wrap({ ok: false });
      }
    },

    handleFetch(input: unknown): FetchOutput {
      if (
        !isRecord(input) ||
        typeof input["id"] !== "string" ||
        typeof input["part"] !== "number"
      ) {
        throw new Error("Invalid fetch request");
      }
      const { id, part } = input as FetchInput;
      return { chunk: chunks.take(id, part) };
    },

    /**
     * Orca reports a focus change, and also whenever the focused workspace's terminals change, so
     * what it names has to be compared as a workspace, not as a report: only a different workspace
     * is passed on.
     *
     * Orca 1.4.x names the workspace by name and branch alone, and worktrees such as `main` or
     * `develop` share both across projects, so two reports about different workspaces can read the
     * same. The workspace is therefore resolved to its path first (by its terminals when the name
     * is not enough) and the paths are compared. A report that cannot be resolved changes nothing,
     * and neither does focus passing to no workspace, so coming back to the same one is no move.
     */
    async onWorkspaceChanged(payload: unknown): Promise<void> {
      const context =
        isRecord(payload) && isRecord(payload["context"])
          ? (payload["context"] as FocusedContext)
          : null;
      if (context === null) {
        return;
      }

      const first = !focusReported;
      focusReported = true;
      const sequence = ++focusSequence;

      const workspaces = await listLocalWorkspaces(orca.host).catch(() => []);
      const workspace = await exactFocusedWorkspace(context, workspaces);
      const reported = `${context.displayName} (${context.branch})`;
      if (workspace === undefined) {
        orca.log(
          `Focus on ${reported}: could not tell which workspace that is, so the panel stays.`
        );
        return;
      }
      if (sequence !== focusSequence) {
        return;
      }

      const path = getPathFromStr(workspace.path);
      const previous = focusedPath;
      focusedPath = path;
      if (first || path === previous) {
        orca.log(
          `Focus on ${reported}: ${first ? "the workspace the panel opened on" : "the same workspace"}.`
        );
        return;
      }

      orca.log(`Focus on ${reported}: moving the panel to ${path}.`);
      orca.panels.post(EVENT_FOCUS_REPO, { path } satisfies FocusRepoEvent);
    },

    /** A workspace appeared: if it holds a repository, add it to the panel's list. */
    async onWorkspaceCreated(payload: unknown): Promise<void> {
      const path = isRecord(payload) ? payload["path"] : undefined;
      if (typeof path === "string" && (await isGitRepository(path, config.gitPath))) {
        notify("repo.changed", { type: "created", repo: toGitRepo(path) });
      }
    },

    onWorkspaceRemoved(payload: unknown): void {
      const path = isRecord(payload) ? payload["path"] : undefined;
      if (typeof path === "string") {
        notify("repo.changed", { type: "deleted", path: getPathFromStr(path) });
      }
    },

    dispose(): void {
      watcher.dispose();
    }
  };
}

export type Runtime = ReturnType<typeof createRuntime>;
