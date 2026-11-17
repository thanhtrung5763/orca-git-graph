# Repository instructions

Git Graph for [Orca](https://github.com/stablyai/orca): a sidebar panel that draws a repository's
commit graph and runs common Git actions. It is only an Orca plugin (manifest `orca-plugin.json`,
id `git-graph`, `trusted-worker` execution). It began as a port of neo-git-graph, but the VS Code
extension is gone from this repository; do not add VS Code extension code back.

## Licence: read before borrowing code

The code is MIT, from [asispts/neo-git-graph](https://github.com/asispts/neo-git-graph), which forks the
last MIT version of mhutchie's Git Graph. mhutchie's later versions
([mhutchie/vscode-git-graph](https://github.com/mhutchie/vscode-git-graph)) are **not** MIT and must
not be copied or adapted into this repository, even in part. Use them only as a feature reference and
write the code independently. Keep the notices in `LICENSE`.

## Commands

pnpm only (`packageManager` is pinned). Node 24.

| Command                          | What it does                                                                 |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm run build`                 | Build the worker and the panel into `out-orca/` (`watch` rebuilds on change) |
| `pnpm run package`               | Typecheck, lint, then build minified: the release build                      |
| `pnpm run typecheck`             | `tsc` over the worker, the panel, the UI and all test projects               |
| `pnpm run lint` / `lint:fix`     | oxlint                                                                       |
| `pnpm run format` / `format:fix` | oxfmt (`format` only checks)                                                 |
| `pnpm run test`                  | vitest: `backend`, `orca` and `webview` projects (real `git`, real files)    |
| `pnpm run bench`                 | Load and render benchmark on real repositories (see `docs/performance.md`)   |
| `orca plugin validate .`         | Check the manifest the way Orca loads it                                     |

Before finishing a change run `format`, `lint`, `typecheck` and `test`; CI runs the same, then builds.

## Layout

- `src/backend/`: git queries and actions on `simple-git`. No Orca or UI code.
- `src/orca/worker/`: the `trusted-worker` (Node). Answers the panel's requests, watches repositories,
  follows Orca's focused workspace, writes the commit-graph cache. Entry: `main.ts`.
- `src/orca/panel/`: the `html` panel's shell (bridge, theme, find, diff overlay, keyboard, responsive
  CSS). `bridge.ts` turns the UI's `postMessage` calls into `plugin.request` calls.
- `src/orca/shared/protocol.ts`: the contract between panel and worker.
- `src/webview/`: the UI (Preact, signals, Tailwind). Its one host seam, `@/webview/lib/vscode`, is
  replaced at build time by `src/orca/panel/vscode-api.ts` (see `esbuild.js`). The name is historical.
- `src/types/`, `src/l10n/`: shared types and the English strings (`t()` is a tiny formatter).
- `tests/{backend,orca,webview}/`: one folder per vitest project. `scripts/bench/`: bench harness
  with a fake Orca and a headless-Chrome driver.
- `docs/orca-plugin.md` (how it works), `docs/performance.md` (measurements; update it with numbers
  when you change performance).

## Things that bite in Orca

- **Answers must be JSON.** Orca rejects an answer that does not survive a JSON round trip (`NaN`,
  `Infinity`) with "answered with a non-JSON value". Git's `-` line counts for binary files once caused
  this: use `null`.
- **Answers are capped at 1 MiB** (input 64 KiB, posts 256 KiB). Large answers are chunked in
  `worker/chunks.ts` and fetched with `gg.fetch`.
- **The worker may be stopped when idle.** Every message names its repository; keep it stateless
  across restarts. The status bar item in the manifest keeps it alive for watching.
- **Orca reports the focused workspace by name and branch**, which are not unique. Resolve it to a
  path (`worker/workspaces.ts`, `terminals.ts`) before comparing; do not move the panel on a guess.
- **Plugin frames cannot use the clipboard API**; copy runs in the frame with `execCommand`.
- **Settings are flat**: `graphColours` is one string separated by `;`. Settings live in
  `orca-plugin.json` and are parsed by `worker/config.ts`; a test keeps the two in step.
- Workspaces on SSH or other remote hosts are skipped: the worker runs the local `git`.

## Testing against a real Orca

Unit tests do not prove the plugin works inside Orca. For a change that touches the worker, the panel
or the manifest:

```sh
pnpm run build
orca plugin dev reload .            # or `orca plugin dev load .` the first time
orca plugin dev request local.git-graph gg.msg --data '{"command":"commitDetails","repo":"<path>","commitHash":"<sha>","hasParents":true}' --json
orca plugin open local.git-graph --panel git-graph
orca plugin shot local.git-graph --panel git-graph --out /tmp/shot.png
orca plugin logs local.git-graph
```

`dev load` of an unapproved plugin prints a fingerprint and does nothing until approved. The plugin
runs code with the user's account access, so only pass `--approve <fingerprint>` when the user has
asked to run this plugin. The development key is `local.git-graph`. An html panel's `shot` only waits
for the page to load: open the panel and wait a few seconds first. Do not run actions that change a
repository (checkout, reset, push, delete) against the user's own repositories; use a scratch repo.

## Releasing

Orca lists community plugins automatically from a public repository with the `orca-plugin` topic and
a `vX.Y.Z` tag. **Do not open pull requests to `stablyai/orca-plugins`**: it only takes official plugins.

1. Bump `version` in both `orca-plugin.json` and `package.json`, and commit as `chore(release): X.Y.Z`.
   A published version is never rebuilt with different bytes, and a pushed tag is never moved: ship
   fixes as a new version.
2. `pnpm run package` and commit `out-orca/` with the source. Orca installs the committed files, and
   its review policy requires generated JavaScript to ship with its source. No bundled native binaries.
3. `orca plugin validate .` and `orca plugin release-entry .` (it reads the committed `HEAD`).
4. Tag `vX.Y.Z` on that commit and push the branch and the tag.

Listing status: `https://www.onorca.dev/plugins/thanhtrung5763/orca-git-graph`.

## Commits and pull requests

Commits follow [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): subject`.

- **Type**: `feat` (new behaviour), `fix` (a bug), `perf`, `refactor`, `docs`, `test`, `build`
  (`esbuild.js`, dependencies, `out-orca/` only), `ci`, `chore`. Use `feat!:` or a `BREAKING CHANGE:`
  footer when a setting or the protocol changes in a way that breaks existing users.
- **Scope** is optional and names the area: `graph`, `panel`, `worker`, `backend`, `ui`, `find`, `diff`,
  `manifest`, `docs`. Leave it out when a change spans several.
- **Subject**: imperative, lower case after the colon, no full stop, 72 characters at most
  (`fix(graph): keep the column as wide as its lanes`).
- **Body**: say why, not what the diff already shows; wrap at 100 columns. Reference an issue with
  `Fixes #123` in a footer.
- One logical change per commit, with its tests. Do not mix a refactor with a fix.
- A release is its own commit: `chore(release): 0.1.6` (version bump and rebuilt `out-orca/`), tagged
  `v0.1.6`. Do not put source changes in it.

Pull requests:

- The title is the commit subject the change would have, in the same form: `type(scope): subject`.
  Branches are named `type/short-topic` (`fix/graph-column-width`).
- The description has what changed and why, how it was tested (`format`, `lint`, `typecheck`, `test`,
  and for a change to the worker, the panel or the manifest, the steps from "Testing against a real
  Orca"), and a screenshot for anything visible.
- Keep a pull request to one change. Do not bump `version` or commit `out-orca/` in it: the maintainer
  does that in the release commit.
- Merge with a squash, so the title above becomes the commit on `main`.
- Never open a pull request to `stablyai/orca-plugins` (see Releasing).

## Style

- TypeScript, strict. oxfmt (100 columns, no trailing commas) and oxlint decide formatting and lint;
  run `format:fix` instead of arguing with them.
- Prefer small, tested changes. Behaviour that touches git runs in tests against a real temporary
  repository (`tests/backend/helpers.ts`), not mocks.
- On macOS, `sed -i` needs an argument (`sed -i ''`); prefer editing files with the editor tools.
