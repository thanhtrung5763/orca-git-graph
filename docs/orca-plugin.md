# Git Graph for Orca: how it works

Git Graph is a plugin for [Orca](https://github.com/stablyai/orca). It adds a **Git Graph** panel to
Orca's right sidebar. It started as a port of [neo-git-graph](https://github.com/asispts/neo-git-graph),
the MIT-licensed fork of mhutchie's Git Graph for VS Code, and keeps that project's git logic and UI.

## Build and load

```sh
pnpm install
pnpm run build               # writes out-orca/ (use --watch with `pnpm run watch`)
orca plugin validate .       # checks orca-plugin.json
orca plugin dev watch .      # loads the folder, reloads on change, streams logs
```

`dev watch` asks you to approve the plugin: it runs its own Node process with your account's access
(it runs `git`, watches files and reads your workspaces), which is why Orca asks first. Then open the
Git Graph icon in the right sidebar.

| Script               | What it does                                                 |
| -------------------- | ------------------------------------------------------------ |
| `pnpm run build`     | Build the worker and the panel into `out-orca/`              |
| `pnpm run package`   | Typecheck, lint, then build minified                         |
| `pnpm run typecheck` | Typecheck the worker, the panel, the UI and the tests        |
| `pnpm run test`      | Run all tests (the worker's use a real `git` and real files) |
| `pnpm run bench`     | Measure load and render times on real repositories           |

## How it works

The plugin has two halves that talk through messages, like the VS Code extension it came from: a
Preact UI and a host that runs git.

| Part         | Where                                                           |
| ------------ | --------------------------------------------------------------- |
| Host         | `trusted-worker` Node process (`src/orca/worker`)               |
| UI           | `html` panel in an isolated frame (`src/orca/panel`)            |
| Messages     | `plugin.request` / `panels.post`                                |
| Repositories | `workspace.list` (local workspaces)                             |
| Settings     | `settings.get`, `storage`                                       |
| Theme        | Orca's `--orca-*` variables, mapped in `panel/theme-bridge.css` |

- **`src/backend/`** holds the git queries and actions (built on `simple-git`).
- **`src/webview/`** is the UI (Preact, signals, Tailwind). It talks to the host through
  `@/webview/lib/vscode`, a thin seam that `esbuild.js` swaps for `src/orca/panel/vscode-api.ts`.
- **`src/orca/panel/bridge.ts`** turns each `postMessage` into a `plugin.request` and each answer or
  push back into the message event the UI expects. `src/orca/shared/protocol.ts` is the contract.
- **`src/orca/worker/`** answers those requests by running the `src/backend` logic.

Differences worth knowing:

- **Diffs** open in a viewer inside the panel (`panel/diff/`), because Orca has no diff editor. The
  worker returns the file's `git diff`; the panel shows it unified or side by side.
- **Up and Down move through the commits**, opening each one's details, like the original Git Graph.
  neo-git-graph only reacts to the mouse there (`src/orca/panel/keyboard.ts`).
- **Answers over about 800 KB** are split and fetched in parts, since Orca caps an answer at 1 MiB.
- **Every message names its repository and the worker follows it.** Orca may stop an idle worker; the
  open panel then carries on with the repository it shows.
- **Copy** runs in the frame (`execCommand`), as plugin frames cannot use the clipboard API; the worker
  has a fallback.
- **The worker is kept running** by the status bar item in the manifest, which Orca does for plugins
  that have one. That keeps file watching, and so auto-refresh, alive while the panel is closed.
- **The repository list** has the focused Orca workspace first, so the panel opens on it, and
  switching projects in Orca's sidebar switches the graph to that workspace's repository. Orca 1.4.x
  reports a focused workspace by name and branch only, and worktrees share names (`main`, `develop`),
  so when those name several workspaces the worker asks Orca's own CLI (`orca terminal list`) which
  one holds the focused terminal. Whether focus moved is decided by the workspace a report resolves
  to, not by the report: two projects' `main` read the same, while terminals opening or closing in
  the focused workspace, or focus passing to no workspace, move nothing. If the CLI is not reachable
  the panel stays where it is rather than guess; Orca builds that report a workspace id need none of
  this and switch exactly.
- **Large repositories get a commit-graph file.** Without one, `git log --date-order` walks the whole
  history before showing the first commit: about 1.3 s on a 170,000-commit repository, 0.02 s with the
  file. When a load takes over 200 ms and the repository has none, the worker writes one in the
  background (`git commit-graph write --reachable --split`), once, and leaves the repository alone for a
  day if that fails. It is one cache file under `.git/objects/info`, which `git gc` writes too, and is
  safe to delete. The setting "Speed up large repositories" turns this off.
- **Workspaces on SSH or other hosts** are skipped: the worker runs `git` on this machine.
- **Settings** live in Orca's Settings under the plugin. `graphColours` is one string, colours
  separated by `;`, because Orca settings are flat.

Left out: avatars (deprecated upstream) and translations (English only).

## Origins and licence

The git logic and UI come from neo-git-graph (MIT, Copyright (c) 2019 mhutchie, fork (c) 2026-present
asispts). The code of mhutchie's later, non-MIT versions of Git Graph is not used: feature ideas
only, written independently. See `LICENSE`.

## Publishing

Orca lists community plugins from a public repository with the `orca-plugin` topic and a version tag.
Orca's review rule is that generated JavaScript may only be committed with its source, so commit
`out-orca/` (built with `pnpm run package`) on the release commit; it is committed here. Run `orca plugin validate .` and
`orca plugin release-entry .` first. This repository has not been listed yet.
