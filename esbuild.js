// Builds the Orca plugin: the worker (`main`) and the panel (the `entry` page) into `out-orca/`.
// `node esbuild.js [--production] [--watch]`.
const fs = require("node:fs");
const path = require("node:path");

const tailwindcss = require("@tailwindcss/postcss");
const esbuild = require("esbuild");
const postcss = require("postcss");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");
const OUT_DIR = "out-orca";

const problemMatcher = (name) => ({
  name: `problem-matcher-${name}`,
  setup(build) {
    build.onStart(() => console.log(`[${name}] build started`));
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        console.error(`✘ [ERROR] ${text}`);
        if (location) {
          console.error(`    ${location.file}:${location.line}:${location.column}:`);
        }
      }
      console.log(`[${name}] build finished`);
    });
  }
});

/** `@/x` is `src/x`, as in `esbuild.js`. */
const aliasPlugin = {
  name: "alias",
  setup(build) {
    build.onResolve({ filter: /^@\// }, async (args) => {
      const resolved = path.resolve(__dirname, "src", args.path.slice(2));
      return build.resolve(resolved, { kind: args.kind, resolveDir: path.dirname(resolved) });
    });
  }
};

/** Swaps a module for another file. Registered before `aliasPlugin`, so it wins. */
const replacePlugin = (name, filter, replacement) => ({
  name,
  setup(build) {
    build.onResolve({ filter }, () => ({ path: path.resolve(__dirname, replacement) }));
  }
});

// Same as `esbuild.js`: Tailwind (through PostCSS) runs over every CSS file before esbuild bundles it.
const tailwindPlugin = {
  name: "tailwindcss",
  setup(build) {
    const processor = postcss([tailwindcss()]);
    build.onLoad({ filter: /\.css$/ }, async (args) => {
      const source = await fs.promises.readFile(args.path, "utf8");
      const result = await processor.process(source, { from: args.path });

      const watchFiles = [];
      const watchDirs = [];
      for (const message of result.messages) {
        if (message.type === "dependency") {
          watchFiles.push(message.file);
        } else if (message.type === "dir-dependency") {
          watchDirs.push(message.dir);
        }
      }

      return {
        contents: result.css,
        loader: "css",
        resolveDir: path.dirname(args.path),
        watchFiles,
        watchDirs
      };
    });
  }
};

/** Copies the panel page next to its script and stylesheet. */
const copyPanelPagePlugin = {
  name: "copy-panel-page",
  setup(build) {
    build.onEnd(() => {
      fs.copyFileSync(
        path.resolve(__dirname, "src/orca/panel/index.html"),
        path.resolve(__dirname, OUT_DIR, "panel.html")
      );
    });
  }
};

async function main() {
  fs.mkdirSync(path.resolve(__dirname, OUT_DIR), { recursive: true });

  const common = {
    bundle: true,
    minify: production,
    sourcemap: production ? false : "inline",
    sourcesContent: false,
    logLevel: "silent"
  };

  // The worker is an ES module that Node runs. simple-git and its dependencies are CommonJS and
  // `require` Node's builtins, so the bundle gets a `require` to answer with.
  const worker = await esbuild.context({
    ...common,
    entryPoints: ["src/orca/worker/main.ts"],
    outfile: `${OUT_DIR}/worker.mjs`,
    format: "esm",
    platform: "node",
    target: "node20",
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"
    },
    plugins: [aliasPlugin, problemMatcher("worker")]
  });

  const panel = await esbuild.context({
    ...common,
    entryPoints: { panel: "src/orca/panel/main.tsx" },
    outdir: OUT_DIR,
    format: "iife",
    target: "es2020",
    jsx: "automatic",
    jsxImportSource: "preact",
    plugins: [
      // The webview's only seam to VS Code: `acquireVsCodeApi()`.
      replacePlugin("vscode-api", /^@\/webview\/lib\/vscode$/, "src/orca/panel/vscode-api.ts"),
      tailwindPlugin,
      aliasPlugin,
      copyPanelPagePlugin,
      problemMatcher("panel")
    ]
  });

  if (watch) {
    await Promise.all([worker.watch(), panel.watch()]);
  } else {
    await worker.rebuild();
    await worker.dispose();
    await panel.rebuild();
    await panel.dispose();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
