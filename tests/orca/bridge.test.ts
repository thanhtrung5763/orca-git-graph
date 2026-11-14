import { beforeEach, describe, expect, it, vi } from "vitest";

import { createBridge, type BridgeDeps } from "@/orca/panel/bridge";
import type { DiffPayload } from "@/orca/shared/protocol";

type Handler = (payload: unknown) => void;

function setup(request: (name: string, input?: unknown) => Promise<unknown>) {
  const handlers = new Map<string, Handler>();
  const dispatched: unknown[] = [];
  const deps = {
    plugin: {
      request: vi.fn(request),
      on: vi.fn((event: string, handler: Handler) => {
        handlers.set(event, handler);
        return { dispose: vi.fn() };
      })
    },
    dispatch: vi.fn((data: unknown) => {
      dispatched.push(data);
    }),
    showDiff: vi.fn(),
    copyText: vi.fn(() => true),
    locale: "fr-FR",
    log: vi.fn(),
    newId: () => "id-1"
  } satisfies BridgeDeps;
  return { bridge: createBridge(deps), deps, dispatched, handlers };
}

const data = (value: unknown) => ({ data: value });

describe("createBridge", () => {
  let diff: DiffPayload;

  beforeEach(() => {
    diff = {
      title: "a.txt (abc^ ↔ abc)",
      commitHash: "abc",
      oldFilePath: "a.txt",
      newFilePath: "a.txt",
      type: "M",
      patch: "@@ -1 +1 @@\n-a\n+b\n",
      truncated: false
    };
  });

  describe("RPC requests", () => {
    it("answers an RPC request with an rpc.response carrying the result", async () => {
      const { bridge, deps, dispatched } = setup(async () =>
        data({ ok: true, result: { repos: [] } })
      );

      await bridge.send({ kind: "rpc.request", id: "r1", method: "repo.scan", params: null });

      expect(deps.plugin.request).toHaveBeenCalledWith(
        "gg.rpc",
        { method: "repo.scan", params: null },
        { timeoutMs: 120_000 }
      );
      expect(dispatched).toEqual([
        { kind: "rpc.response", id: "r1", success: true, result: { repos: [] } }
      ]);
    });

    it("puts Orca's language in the settings the webview reads", async () => {
      const { bridge, dispatched } = setup(async () =>
        data({ ok: true, result: { l10n: {}, config: { locale: "en", graphStyle: "rounded" } } })
      );

      await bridge.send({
        kind: "rpc.request",
        id: "r1",
        method: "webview.initialize",
        params: null
      });

      expect(dispatched).toEqual([
        {
          kind: "rpc.response",
          id: "r1",
          success: true,
          result: { l10n: {}, config: { locale: "fr-FR", graphStyle: "rounded" } }
        }
      ]);
    });

    it("passes on an error the worker reports", async () => {
      const { bridge, dispatched } = setup(async () => data({ ok: false, error: "no workspace" }));

      await bridge.send({ kind: "rpc.request", id: "r1", method: "git.init", params: null });

      expect(dispatched).toEqual([
        { kind: "rpc.response", id: "r1", success: false, error: "no workspace" }
      ]);
    });

    it("answers with an error when the request itself fails", async () => {
      const { bridge, dispatched } = setup(async () => {
        throw new Error("worker unavailable");
      });

      await bridge.send({ kind: "rpc.request", id: "r1", method: "repo.scan", params: null });

      expect(dispatched).toEqual([
        { kind: "rpc.response", id: "r1", success: false, error: "worker unavailable" }
      ]);
    });

    it("copies in the frame when it can, without asking the worker", async () => {
      const { bridge, deps, dispatched } = setup(async () => data({ ok: true, result: true }));

      await bridge.send({
        kind: "rpc.request",
        id: "r1",
        method: "clipboard.copy",
        params: "abc123"
      });

      expect(deps.copyText).toHaveBeenCalledWith("abc123");
      expect(deps.plugin.request).not.toHaveBeenCalled();
      expect(dispatched).toEqual([{ kind: "rpc.response", id: "r1", success: true, result: true }]);
    });

    it("asks the worker to copy when the frame cannot", async () => {
      const { bridge, deps, dispatched } = setup(async () => data({ ok: true, result: true }));
      deps.copyText.mockReturnValue(false);

      await bridge.send({
        kind: "rpc.request",
        id: "r1",
        method: "clipboard.copy",
        params: "abc123"
      });

      expect(deps.plugin.request).toHaveBeenCalledWith(
        "gg.rpc",
        { method: "clipboard.copy", params: "abc123" },
        expect.anything()
      );
      expect(dispatched).toEqual([{ kind: "rpc.response", id: "r1", success: true, result: true }]);
    });
  });

  describe("command messages", () => {
    it("delivers each response the worker returns", async () => {
      const { bridge, deps, dispatched } = setup(async () =>
        data({
          messages: [{ command: "loadBranches", branches: ["main"] }, { command: "refresh" }]
        })
      );
      const message = {
        command: "loadBranches",
        repo: "/repo",
        showRemoteBranches: true,
        hard: false
      };

      await bridge.send(message);

      expect(deps.plugin.request).toHaveBeenCalledWith("gg.msg", message, { timeoutMs: 120_000 });
      expect(dispatched).toEqual([
        { command: "loadBranches", branches: ["main"] },
        { command: "refresh" }
      ]);
    });

    it("delivers nothing for a message the worker has no answer to", async () => {
      const { bridge, dispatched } = setup(async () => data({ messages: [] }));

      await bridge.send({ command: "selectRepo", repo: "/repo" });

      expect(dispatched).toEqual([]);
    });

    it("reports a failed action to the webview as the action's status", async () => {
      const { bridge, dispatched } = setup(async () => {
        throw new Error("timeout");
      });

      await bridge.send({ command: "pushTag", repo: "/repo", tagName: "v1" });

      expect(dispatched).toEqual([{ command: "pushTag", status: "timeout" }]);
    });

    it("only logs a failed query", async () => {
      const { bridge, deps, dispatched } = setup(async () => {
        throw new Error("timeout");
      });

      await bridge.send({ command: "loadCommits", repo: "/repo" });

      expect(dispatched).toEqual([]);
      expect(deps.log).toHaveBeenCalledWith("Request failed: loadCommits", expect.any(Error));
    });
  });

  describe("viewDiff", () => {
    const message = {
      command: "viewDiff",
      repo: "/repo",
      commitHash: "abc",
      oldFilePath: "a.txt",
      newFilePath: "a.txt",
      type: "M"
    };

    it("opens the diff viewer and reports success", async () => {
      const { bridge, deps, dispatched } = setup(async () => data({ ok: true, diff }));

      await bridge.send(message);

      expect(deps.plugin.request).toHaveBeenCalledWith("gg.diff", message, expect.anything());
      expect(deps.showDiff).toHaveBeenCalledWith(diff);
      expect(dispatched).toEqual([{ command: "viewDiff", success: true }]);
    });

    it("reports failure when the worker cannot make the diff", async () => {
      const { bridge, deps, dispatched } = setup(async () => data({ ok: false }));

      await bridge.send(message);

      expect(deps.showDiff).not.toHaveBeenCalled();
      expect(dispatched).toEqual([{ command: "viewDiff", success: false }]);
    });

    it("reports failure when the request fails", async () => {
      const { bridge, dispatched } = setup(async () => {
        throw new Error("gone");
      });

      await bridge.send(message);

      expect(dispatched).toEqual([{ command: "viewDiff", success: false }]);
    });
  });

  describe("large answers", () => {
    it("fetches the parts and reads the value they make up", async () => {
      const value = { messages: [{ command: "refresh" }] };
      const json = JSON.stringify(value);
      const parts = [json.slice(0, 10), json.slice(10)];
      const { bridge, deps, dispatched } = setup(async (name, input) =>
        name === "gg.fetch"
          ? { chunk: parts[(input as { part: number }).part] }
          : { chunked: { id: "big", parts: 2 } }
      );

      await bridge.send({ command: "loadCommits", repo: "/repo" });

      expect(deps.plugin.request).toHaveBeenCalledWith(
        "gg.fetch",
        { id: "big", part: 0 },
        expect.anything()
      );
      expect(deps.plugin.request).toHaveBeenCalledWith(
        "gg.fetch",
        { id: "big", part: 1 },
        expect.anything()
      );
      expect(dispatched).toEqual([{ command: "refresh" }]);
    });

    it("treats an answer of an unknown shape as a failure", async () => {
      const { bridge, dispatched } = setup(async () => ({ surprise: true }));

      await bridge.send({ command: "pushTag", repo: "/repo" });

      expect(dispatched).toEqual([
        { command: "pushTag", status: "Unexpected response from the Git Graph worker." }
      ]);
    });
  });

  describe("pushes from the worker", () => {
    it("turns them into rpc.notify messages", () => {
      const { bridge, handlers, dispatched } = setup(async () => data({}));

      bridge.listen();
      handlers.get("gg.notify")?.({ name: "repo.updated", message: { path: "/repo" } });

      expect(dispatched).toEqual([
        { kind: "rpc.notify", id: "id-1", name: "repo.updated", message: { path: "/repo" } }
      ]);
    });

    it("ignores a push of the wrong shape", () => {
      const { bridge, handlers, dispatched } = setup(async () => data({}));

      bridge.listen();
      handlers.get("gg.notify")?.({ nope: 1 });
      handlers.get("gg.notify")?.(null);

      expect(dispatched).toEqual([]);
    });
  });

  it("ignores messages it does not understand", async () => {
    const { bridge, deps, dispatched } = setup(async () => data({}));

    await bridge.send("hello");
    await bridge.send(null);
    await bridge.send({ kind: "other" });

    expect(deps.plugin.request).not.toHaveBeenCalled();
    expect(dispatched).toEqual([]);
  });
});
