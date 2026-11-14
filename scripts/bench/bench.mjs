#!/usr/bin/env node
// Benchmarks the Git Graph plugin against real repositories.
//
//   node scripts/bench/bench.mjs --repo /path/to/repo [--repo ...] [options]
//
//   --counts 301,2001,5001        commits to load, for the worker and layout sections
//   --panel-counts 301,2001,5001  commits to load, for the browser section
//   --only worker,layout,panel    which sections to run (default: all three)
//   --no-build                    use the existing out-orca/ instead of building a production one
//   --label baseline              name for the results
//   --json results.json           also write the results here
//
// worker: the built worker answering `loadCommits` (time, payload, memory).
// layout: the graph layout of the commits that answer returns.
// panel:  the built panel in headless Chrome (first paint, DOM size, interaction latency, scrolling).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

import { launch } from "./cdp.mjs";
import { loadWorker } from "./fake-orca.mjs";
import { startHarness } from "./harness.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const RUNS = 3;

const numbers = (text) => text.split(",").map(Number);

function parseArgs(argv) {
  const options = {
    repos: [],
    counts: [301, 2001, 5001],
    panelCounts: [301, 2001, 5001],
    only: ["worker", "layout", "panel"],
    build: true,
    label: "run",
    json: null
  };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--repo") {
      options.repos.push(path.resolve(argv[++index]));
    } else if (flag === "--counts") {
      options.counts = numbers(argv[++index]);
    } else if (flag === "--panel-counts") {
      options.panelCounts = numbers(argv[++index]);
    } else if (flag === "--only") {
      options.only = argv[++index].split(",");
    } else if (flag === "--no-build") {
      options.build = false;
    } else if (flag === "--label") {
      options.label = argv[++index];
    } else if (flag === "--json") {
      options.json = argv[++index];
    } else {
      throw new Error(`Unknown option ${flag}`);
    }
  }
  if (options.repos.length === 0) {
    throw new Error("Give at least one --repo");
  }
  return options;
}

const median = (values) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
const round = (value, digits = 0) => Math.round(value * 10 ** digits) / 10 ** digits;

/** The answer of a worker request, with its parts fetched when it was too large to send whole. */
async function readAnswer(handlers, answer) {
  if ("data" in answer) {
    const json = JSON.stringify(answer.data);
    return { value: answer.data, bytes: Buffer.byteLength(json), parts: 1 };
  }
  const { id, parts } = answer.chunked;
  const pieces = [];
  for (let part = 0; part < parts; part++) {
    pieces.push((await handlers.get("gg.fetch")({ id, part }, {})).chunk);
  }
  const json = pieces.join("");
  return { value: JSON.parse(json), bytes: Buffer.byteLength(json), parts };
}

const loadInput = (repo, count) => ({
  command: "loadCommits",
  repo,
  branchName: "",
  maxCommits: count,
  showRemoteBranches: true,
  hard: false
});

async function benchWorker(repo, counts) {
  const { handlers, deactivate } = await loadWorker({ pluginRoot: root, repo });
  const rows = [];
  try {
    for (const count of counts) {
      const input = loadInput(repo, count);
      const times = [];
      let answer;
      for (let run = 0; run < RUNS; run++) {
        const start = performance.now();
        answer = await handlers.get("gg.msg")(input, {});
        times.push(performance.now() - start);
      }
      const { value, bytes, parts } = await readAnswer(handlers, answer);
      rows.push({
        repo: path.basename(repo),
        requested: count,
        commits: value.messages[0].commits.length,
        ms: round(median(times)),
        payloadKb: round(bytes / 1024),
        parts,
        peakRssMb: round(process.resourceUsage().maxRSS / 1024)
      });
    }
  } finally {
    await deactivate?.();
  }
  return rows;
}

/** The graph layout, built from the sources so it can be timed without a browser. */
async function bundleLayout() {
  const alias = {
    name: "alias",
    setup(b) {
      b.onResolve({ filter: /^@\// }, (args) => {
        const resolved = path.resolve(root, "src", args.path.slice(2));
        return b.resolve(resolved, { kind: args.kind, resolveDir: path.dirname(resolved) });
      });
    }
  };
  const result = await build({
    entryPoints: [path.join(root, "src/webview/graph/layout.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
    plugins: [alias]
  });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gg-layout-")), "layout.mjs");
  fs.writeFileSync(file, result.outputFiles[0].text);
  return import(pathToFileURL(file).href);
}

async function benchLayout(repo, counts) {
  const { computeGraphLayout } = await bundleLayout();
  const { handlers, deactivate } = await loadWorker({ pluginRoot: root, repo });
  const rows = [];
  try {
    for (const count of counts) {
      const answer = await handlers.get("gg.msg")(loadInput(repo, count), {});
      const { value } = await readAnswer(handlers, answer);
      const { commits, head } = value.messages[0];

      computeGraphLayout(commits, head); // warm up the compiler
      const times = [];
      let layout;
      for (let run = 0; run < RUNS; run++) {
        const start = performance.now();
        layout = computeGraphLayout(commits, head);
        times.push(performance.now() - start);
      }
      rows.push({
        repo: path.basename(repo),
        commits: commits.length,
        layoutMs: round(median(times), 1),
        branches: layout.branches.length,
        // A fingerprint of the whole layout: equal before and after a change means the same graph.
        hash: createHash("sha1").update(JSON.stringify(layout)).digest("hex").slice(0, 10),
        lines: layout.branches.reduce((sum, branch) => sum + branch.lines.length, 0)
      });
    }
  } finally {
    await deactivate?.();
  }
  return rows;
}

/** Helpers that run inside the page, so latency is measured up to the next painted frame. */
const PAGE_HELPERS = `
window.__bench = {
  frame: () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  until: async (condition, timeout = 30000) => {
    const start = performance.now();
    while (!condition()) {
      if (performance.now() - start > timeout) throw new Error('timed out waiting');
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  },
  rows: () => [...document.querySelectorAll('table > tbody > tr')]
    .filter((row) => !row.querySelector(':scope > td[colspan]')),
  detailsLoaded: () => !!document.querySelector('table td[colspan] .select-text'),
  // The details view is the spanning cell with content; the blank rows that stand in for rows left out also span.
  noDetails: () => !document.querySelector('table td[colspan] > div')
};`;

const PAGE_METRICS = `(async () => {
  const b = window.__bench;
  const median = (xs) => xs.slice().sort((x, y) => x - y)[Math.floor(xs.length / 2)];
  const repeat = async (fn, times = ${RUNS}) => { const xs = []; for (let i = 0; i < times; i++) xs.push(await fn()); return median(xs); };
  const out = {};

  // Click a commit: its details open under it (a round trip to the worker).
  out.openDetailsMs = await repeat(async () => {
    const rows = b.rows();
    const row = rows[Math.min(10, rows.length - 1)];
    const start = performance.now();
    row.click();
    await b.until(b.detailsLoaded);
    await b.frame();
    const elapsed = performance.now() - start;
    row.click();
    await b.until(b.noDetails);
    await b.frame();
    return elapsed;
  });

  // Down arrow with a commit open: the next one opens. Timed to the frame, not to the worker.
  const rows = b.rows();
  rows[Math.min(5, rows.length - 1)].click();
  await b.until(b.detailsLoaded);
  out.arrowKeyMs = await repeat(async () => {
    const start = performance.now();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    await b.frame();
    const elapsed = performance.now() - start;
    await b.until(b.detailsLoaded);
    return elapsed;
  });
  b.rows()[Math.min(5, b.rows().length - 1)].click();

  // Right click a commit: the context menu opens.
  out.contextMenuMs = await repeat(async () => {
    const row = b.rows()[Math.min(8, b.rows().length - 1)];
    const start = performance.now();
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 200 }));
    await b.until(() => !!document.querySelector('[role="menu"]'));
    await b.frame();
    const elapsed = performance.now() - start;
    document.dispatchEvent(new Event('pointerdown'));
    await b.until(() => !document.querySelector('[role="menu"]'));
    return elapsed;
  });

  // Scroll for a second: frames per second reached.
  out.scrollFps = await new Promise((resolve) => {
    let frames = 0;
    const start = performance.now();
    const step = () => {
      window.scrollBy(0, 60);
      frames++;
      if (performance.now() - start < 1500) requestAnimationFrame(step);
      else { window.scrollTo(0, 0); resolve(frames / ((performance.now() - start) / 1000)); }
    };
    requestAnimationFrame(step);
  });

  out.domNodes = document.getElementsByTagName('*').length;
  return out;
})()`;

async function benchPanel(repo, count, index) {
  const harness = await startHarness({
    pluginRoot: root,
    repo,
    settings: { initialLoadCommits: count }
  });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "gg-bench-chrome-"));
  const page = await launch({ width: 1100, height: 800, port: 9400 + index, profile });
  try {
    await page.send("HeapProfiler.enable");
    const start = performance.now();
    await page.send("Page.navigate", { url: `${harness.url}?nosse=1` });
    await page.waitFor(`document.querySelectorAll('table > tbody > tr').length > 5`, 180000, 10);
    const firstRowsMs = performance.now() - start;
    await page.sleep(800);
    await page.evaluate(PAGE_HELPERS);

    const metrics = await page.evaluate(PAGE_METRICS);
    await page.send("HeapProfiler.collectGarbage");
    const { usedSize } = await page.send("Runtime.getHeapUsage");
    return {
      repo: path.basename(repo),
      requested: count,
      firstRowsMs: round(firstRowsMs),
      domNodes: metrics.domNodes,
      heapMb: round(usedSize / 1048576),
      openDetailsMs: round(metrics.openDetailsMs),
      arrowKeyMs: round(metrics.arrowKeyMs),
      contextMenuMs: round(metrics.contextMenuMs),
      scrollFps: round(metrics.scrollFps)
    };
  } finally {
    await page.close();
    await harness.close();
    // Cleaning up a temporary folder must never cost the measurements.
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* left for the system to clear */
    }
  }
}

function table(title, rows) {
  if (rows.length === 0) {
    return;
  }
  const columns = Object.keys(rows[0]);
  console.log(`\n### ${title}\n`);
  console.log(`| ${columns.join(" | ")} |`);
  console.log(`|${columns.map(() => " --- ").join("|")}|`);
  for (const row of rows) {
    console.log(`| ${columns.map((c) => row[c]).join(" | ")} |`);
  }
}

const options = parseArgs(process.argv.slice(2));

if (options.build) {
  const built = spawnSync("node", ["esbuild.js", "--production"], {
    cwd: root,
    encoding: "utf8"
  });
  if (built.status !== 0) {
    throw new Error(`build failed:\n${built.stdout}${built.stderr}`);
  }
}

const results = {
  label: options.label,
  date: new Date().toISOString(),
  worker: [],
  layout: [],
  panel: []
};
let chromePort = 0;
for (const repo of options.repos) {
  console.error(`# ${repo}`);
  if (options.only.includes("worker")) {
    results.worker.push(...(await benchWorker(repo, options.counts)));
  }
  if (options.only.includes("layout")) {
    results.layout.push(...(await benchLayout(repo, options.counts)));
  }
  if (options.only.includes("panel")) {
    for (const count of options.panelCounts) {
      console.error(`  panel ${count}`);
      results.panel.push(await benchPanel(repo, count, chromePort++));
    }
  }
}

console.log(`\n## ${options.label} (${results.date})`);
table("worker: loadCommits", results.worker);
table("layout: computeGraphLayout", results.layout);
table("panel: headless Chrome", results.panel);
if (options.json) {
  fs.writeFileSync(options.json, JSON.stringify(results, null, 2));
}
