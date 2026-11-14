import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { loadWorker } from "./fake-orca.mjs";

// Orca's limits on what crosses between a panel and its worker, enforced here so that large
// answers are chunked the way they are in Orca.
const MAX_INPUT = 64 * 1024;
const MAX_ANSWER = 1024 * 1024;
const MAX_POST = 256 * 1024;

const THEMES = {
  dark: `--orca-background:#0a0a0a;--orca-foreground:#f0f0f0;--orca-card:#171717;--orca-card-foreground:#f0f0f0;--orca-popover:#171717;--orca-popover-foreground:#f0f0f0;--orca-primary:#e5e5e5;--orca-primary-foreground:#171717;--orca-secondary:#262626;--orca-secondary-foreground:#f0f0f0;--orca-muted:#262626;--orca-muted-foreground:#acacac;--orca-accent:#404040;--orca-accent-foreground:#f0f0f0;--orca-destructive:#7f1d1d;--orca-destructive-foreground:#fafafa;--orca-border:rgb(255 255 255 / 0.07);--orca-input:rgb(255 255 255 / 0.15);--orca-ring:#737373;--orca-radius:0.5rem;`,
  light: `--orca-background:#ffffff;--orca-foreground:#0a0a0a;--orca-card:#ffffff;--orca-card-foreground:#0a0a0a;--orca-popover:#ffffff;--orca-popover-foreground:#0a0a0a;--orca-primary:#171717;--orca-primary-foreground:#fafafa;--orca-secondary:#f5f5f5;--orca-secondary-foreground:#171717;--orca-muted:#f5f5f5;--orca-muted-foreground:#696969;--orca-accent:#f5f5f5;--orca-accent-foreground:#171717;--orca-destructive:#ef4444;--orca-destructive-foreground:#fafafa;--orca-border:#e5e5e5;--orca-input:#e5e5e5;--orca-ring:#a1a1a1;--orca-radius:0.5rem;`
};

const SHIM = `
(() => {
  const listeners = new Map();
  if (!location.search.includes('nosse')) {
    const es = new EventSource('/events');
    es.onmessage = (e) => {
      const { event, payload } = JSON.parse(e.data);
      for (const h of listeners.get(event) ?? []) h(payload);
    };
  }
  const on = (event, handler) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(handler);
    return { dispose: () => listeners.get(event).delete(handler) };
  };
  window.orca = Object.freeze({
    api: { major: 1, minor: 9 },
    locale: 'en-US',
    host: { has: () => false, call: async () => { throw new Error('not in harness'); } },
    on,
    plugin: {
      async request(name, input, options) {
        const res = await fetch('/request', { method: 'POST', body: JSON.stringify({ name, input }) });
        const json = await res.json();
        if (!res.ok) { const err = new Error(json.error); err.code = json.code; throw err; }
        return json.result;
      },
      on
    }
  });
})();`;

function page(html, theme) {
  const live = `window.__THEMES = ${JSON.stringify(THEMES)}; window.__setTheme = (t) => { document.documentElement.className = t; document.getElementById('orca-vars').textContent = ':root{' + window.__THEMES[t] + '}'; };`;
  return html
    .replace("<html ", `<html class="${theme}" `)
    .replace(
      "</head>",
      `<style id="orca-vars">:root{${THEMES[theme]}}</style><script>${live}</script><script>${SHIM}</script></head>`
    );
}

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html" };

/**
 * Serves the built panel (`out-orca/`) with a `window.orca` shim, backed by the built worker running
 * against `repo`, so the panel can be driven in a browser exactly as it runs in Orca's frame.
 */
export async function startHarness({ pluginRoot, repo, settings = {}, port = 0 }) {
  const outDir = path.join(pluginRoot, "out-orca");
  const clients = new Set();
  const { handlers, deactivate } = await loadWorker({
    pluginRoot,
    repo,
    settings,
    onPost(event, payload) {
      const body = JSON.stringify({ event, payload });
      if (Buffer.byteLength(body) > MAX_POST) {
        throw new Error("post too large");
      }
      for (const client of clients) {
        client.write(`data: ${body}\n\n`);
      }
    }
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const reply = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === "/" || url.pathname === "/panel.html") {
      res.writeHead(200, { "content-type": "text/html" });
      const html = fs.readFileSync(path.join(outDir, "panel.html"), "utf8");
      res.end(page(html, url.searchParams.get("theme") === "light" ? "light" : "dark"));
    } else if (url.pathname === "/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      res.write(": hi\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
    } else if (url.pathname === "/request" && req.method === "POST") {
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
      }
      if (Buffer.byteLength(raw) > MAX_INPUT) {
        reply(400, { code: "invalid_params", error: "input too large" });
        return;
      }
      const { name, input } = JSON.parse(raw);
      const handler = handlers.get(name);
      if (!handler) {
        reply(404, { code: "unknown_method", error: `no handler ${name}` });
        return;
      }
      try {
        const result = await handler(input, {
          panel: { id: "p1" },
          signal: new AbortController().signal
        });
        const body = JSON.stringify({ result });
        if (Buffer.byteLength(body) > MAX_ANSWER) {
          reply(500, { code: "action_failed", error: "answer too large" });
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(body);
      } catch (error) {
        reply(500, {
          code: "action_failed",
          error: error instanceof Error ? error.message : String(error)
        });
      }
    } else {
      const file = path.join(outDir, path.basename(url.pathname));
      if (fs.existsSync(file)) {
        res.writeHead(200, {
          "content-type": TYPES[path.extname(file)] ?? "application/octet-stream"
        });
        res.end(fs.readFileSync(file));
      } else {
        res.writeHead(404);
        res.end("not found");
      }
    }
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const { port: actual } = server.address();

  return {
    url: `http://127.0.0.1:${actual}/`,
    async close() {
      for (const client of clients) {
        client.end();
      }
      await new Promise((resolve) => server.close(resolve));
      await deactivate?.();
    }
  };
}
