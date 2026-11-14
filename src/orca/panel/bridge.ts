import {
  EVENT_NOTIFY,
  REQUEST,
  isActionCommand,
  type Answer,
  type DiffOutput,
  type DiffPayload,
  type FetchOutput,
  type MsgOutput,
  type RpcOutput
} from "@/orca/shared/protocol";
import type { Disposable, FramePluginBridge } from "@/orca/types/orca-api";

/** Orca's longest request time; pushing a tag over a slow link can take a while. */
const LONG_TIMEOUT_MS = 120_000;

export type BridgeDeps = {
  plugin: FramePluginBridge;
  /** Hands a message to the webview, as VS Code's `webview.postMessage` did. */
  dispatch: (data: unknown) => void;
  showDiff: (diff: DiffPayload) => void;
  /** Copies text at once, while the person's click still counts as a gesture. */
  copyText: (text: string) => boolean;
  /** Orca's UI language (`orca.locale`). */
  locale: string;
  log: (message: string, error?: unknown) => void;
  newId?: () => string;
};

type RpcRequestEnvelope = { kind: "rpc.request"; id: string; method: string; params: unknown };
type CommandMessage = { command: string } & Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRpcRequest(message: unknown): message is RpcRequestEnvelope {
  return (
    isRecord(message) &&
    message["kind"] === "rpc.request" &&
    typeof message["id"] === "string" &&
    typeof message["method"] === "string"
  );
}

function isCommandMessage(message: unknown): message is CommandMessage {
  return isRecord(message) && typeof message["command"] === "string";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Connects the neo-git-graph webview to the plugin's worker.
 *
 * The webview was written for VS Code: it calls `postMessage` and listens for `message` events.
 * This turns each `postMessage` into a `plugin.request` and each answer, and each push from the
 * worker, back into a message event, so the webview code needs no changes.
 */
export function createBridge(deps: BridgeDeps) {
  const { plugin, dispatch } = deps;
  const newId = deps.newId ?? (() => crypto.randomUUID());

  async function unwrap<T>(answer: unknown): Promise<T> {
    if (isRecord(answer) && "data" in answer) {
      return (answer as { data: T }).data;
    }
    if (isRecord(answer) && isRecord(answer["chunked"])) {
      const { id, parts } = answer["chunked"] as Extract<
        Answer<unknown>,
        { chunked: unknown }
      >["chunked"];
      const pieces = await Promise.all(
        Array.from(
          { length: parts },
          (_, part) =>
            plugin.request(
              REQUEST.fetch,
              { id, part },
              { timeoutMs: LONG_TIMEOUT_MS }
            ) as Promise<FetchOutput>
        )
      );
      return JSON.parse(pieces.map((piece) => piece.chunk).join("")) as T;
    }
    throw new Error("Unexpected response from the Git Graph worker.");
  }

  async function ask<T>(name: string, input: unknown): Promise<T> {
    return unwrap<T>(await plugin.request(name, input, { timeoutMs: LONG_TIMEOUT_MS }));
  }

  function respond(id: string, outcome: { result: unknown } | { error: string }): void {
    dispatch(
      "result" in outcome
        ? { kind: "rpc.response", id, success: true, result: outcome.result }
        : { kind: "rpc.response", id, success: false, error: outcome.error }
    );
  }

  /** `webview.initialize` carries VS Code's display language; Orca's takes its place. */
  function withLocale(result: unknown): unknown {
    if (isRecord(result) && isRecord(result["config"])) {
      return { ...result, config: { ...result["config"], locale: deps.locale } };
    }
    return result;
  }

  async function sendRpc(message: RpcRequestEnvelope): Promise<void> {
    const { id, method, params } = message;

    // A frame may not use the clipboard API, but `execCommand("copy")` works in a click's gesture,
    // which is still live here: `postMessage` runs inside the webview's click handler.
    if (method === "clipboard.copy" && typeof params === "string" && deps.copyText(params)) {
      respond(id, { result: true });
      return;
    }

    try {
      const output = await ask<RpcOutput>(REQUEST.rpc, { method, params });
      respond(
        id,
        output.ok
          ? { result: method === "webview.initialize" ? withLocale(output.result) : output.result }
          : { error: output.error }
      );
    } catch (error) {
      respond(id, { error: errorMessage(error) });
    }
  }

  async function sendDiff(message: CommandMessage): Promise<void> {
    try {
      const output = await ask<DiffOutput>(REQUEST.diff, message);
      if (output.ok) {
        deps.showDiff(output.diff);
      }
      dispatch({ command: "viewDiff", success: output.ok });
    } catch (error) {
      deps.log("Unable to load the diff.", error);
      dispatch({ command: "viewDiff", success: false });
    }
  }

  async function sendCommand(message: CommandMessage): Promise<void> {
    try {
      const output = await ask<MsgOutput>(REQUEST.msg, message);
      for (const response of output.messages) {
        dispatch(response);
      }
    } catch (error) {
      if (isActionCommand(message.command)) {
        // An action that fails to reach the worker reads like one that git refused.
        dispatch({ command: message.command, status: errorMessage(error) });
      } else {
        deps.log(`Request failed: ${message.command}`, error);
      }
    }
  }

  return {
    /** Takes one message the webview posted. */
    async send(message: unknown): Promise<void> {
      if (isRpcRequest(message)) {
        return sendRpc(message);
      }
      if (!isCommandMessage(message)) {
        return;
      }
      return message.command === "viewDiff" ? sendDiff(message) : sendCommand(message);
    },

    /** Starts delivering the worker's pushes (`repo.updated`, ...) to the webview. */
    listen(): Disposable {
      return plugin.on(EVENT_NOTIFY, (payload) => {
        if (isRecord(payload) && typeof payload["name"] === "string" && "message" in payload) {
          dispatch({
            kind: "rpc.notify",
            id: newId(),
            name: payload["name"],
            message: payload["message"]
          });
        }
      });
    }
  };
}

export type Bridge = ReturnType<typeof createBridge>;
