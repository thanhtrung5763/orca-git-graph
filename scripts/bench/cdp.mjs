// A minimal Chrome DevTools Protocol driver: launches headless Chrome and drives one page. No
// dependencies; Node 22 has a WebSocket. Set CHROME_PATH if Chrome is not in its usual place.
import { spawn } from "node:child_process";
import fs from "node:fs";

const CHROME =
  process.env.CHROME_PATH ??
  (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "google-chrome");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function launch({ width = 1100, height = 800, port = 9333, profile }) {
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      `--window-size=${width},${height}`,
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "about:blank"
    ],
    { stdio: "ignore" }
  );
  const exited = new Promise((resolve) => chrome.once("exit", resolve));

  let targets;
  for (let i = 0; i < 50; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      if (targets.some((t) => t.type === "page")) {
        break;
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  let id = 0;
  const pending = new Map();
  const consoleLines = [];
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) {
        reject(new Error(JSON.stringify(msg.error)));
      } else {
        resolve(msg.result);
      }
    } else if (msg.method === "Runtime.consoleAPICalled") {
      consoleLines.push(
        `[${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`
      );
    } else if (msg.method === "Runtime.exceptionThrown") {
      consoleLines.push(
        `[exception] ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`
      );
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, { resolve, reject });
      ws.send(JSON.stringify({ id: n, method, params }));
    });

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false
  });

  const evaluate = async (expression) => {
    const out = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (out.exceptionDetails) {
      throw new Error(out.exceptionDetails.exception?.description ?? out.exceptionDetails.text);
    }
    return out.result.value;
  };

  return {
    send,
    evaluate,
    sleep,
    consoleLines,
    async goto(url) {
      await send("Page.navigate", { url });
      await sleep(1500);
    },
    async waitFor(expression, timeout = 10000, interval = 150) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (await evaluate(expression).catch(() => false)) {
          return true;
        }
        await sleep(interval);
      }
      throw new Error(`timed out waiting for: ${expression}`);
    },
    async click(x, y, { button = "left" } = {}) {
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
        await send("Input.dispatchMouseEvent", {
          type,
          x,
          y,
          button,
          buttons: type === "mousePressed" ? 1 : 0,
          clickCount: 1
        });
      }
    },
    async clickSelector(selector, options) {
      const box = await evaluate(
        `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2}; })()`
      );
      if (!box) {
        throw new Error(`no element ${selector}`);
      }
      await this.click(box.x, box.y, options);
    },
    async chord(key, modifiers, { code, vk } = {}) {
      // modifiers: Alt=1, Ctrl=2, Meta=4, Shift=8
      const params = {
        key,
        code: code ?? `Key${key.toUpperCase()}`,
        windowsVirtualKeyCode: vk ?? key.toUpperCase().charCodeAt(0),
        modifiers
      };
      await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...params });
      await send("Input.dispatchKeyEvent", { type: "keyUp", ...params });
    },
    async type(text) {
      await send("Input.insertText", { text });
    },
    async key(key) {
      const codes = { ArrowUp: 38, ArrowDown: 40, Escape: 27, Enter: 13 };
      const vk = codes[key] ?? 0;
      await send("Input.dispatchKeyEvent", {
        type: "rawKeyDown",
        key,
        code: key,
        windowsVirtualKeyCode: vk
      });
      await send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key,
        code: key,
        windowsVirtualKeyCode: vk
      });
    },
    async shot(file) {
      const { data } = await send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(file, Buffer.from(data, "base64"));
    },
    /** Closes the page and resolves once Chrome has exited, so its profile folder can be removed. */
    close() {
      ws.close();
      chrome.kill();
      return exited;
    }
  };
}
