import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * A stand-in for the `orca` object a worker is given, with one real repository as its only
 * workspace. Used to run the built worker outside Orca, for benchmarks and browser checks.
 */
export function createFakeOrca({ repo, settings = {}, onPost = () => {}, onLog = () => {} }) {
  const handlers = new Map();
  const store = new Map();

  const orca = {
    host: {
      call: async (method) => {
        if (method === "workspace.list") {
          return {
            workspaces: [
              {
                id: "w1",
                kind: "worktree",
                name: path.basename(repo),
                path: repo,
                branch: "main",
                hostId: null
              }
            ]
          };
        }
        if (method === "workspace.readContext") {
          return {
            workspaceId: "w1",
            branch: "main",
            displayName: path.basename(repo),
            terminals: []
          };
        }
        if (method === "settings.get") {
          return { settings };
        }
        throw new Error(`unexpected host call ${method}`);
      },
      has: () => true
    },
    panels: {
      handle(name, fn) {
        handlers.set(name, fn);
        return { dispose() {} };
      },
      post: onPost
    },
    storage: {
      get: async (key) => store.get(key),
      set: async (key, value) => void store.set(key, value)
    },
    events: { on: () => ({ dispose() {} }) },
    log: onLog
  };

  return { orca, handlers };
}

/** Loads the built worker (`out-orca/worker.mjs`) and activates it against a fake Orca. */
export async function loadWorker({ pluginRoot, ...options }) {
  const worker = await import(pathToFileURL(path.join(pluginRoot, "out-orca", "worker.mjs")).href);
  const fake = createFakeOrca(options);
  await worker.default(fake.orca);
  return { ...fake, deactivate: worker.deactivate };
}
