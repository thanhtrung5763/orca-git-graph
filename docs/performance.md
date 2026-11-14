# Performance

How the plugin was measured, what was slow, and what changed. Numbers are from one machine (Apple M1 Pro, macOS,
headless Chrome at 1100x800) on two real repositories: orca (13,543 commits) and a clone of vscode (168,970).
Treat them as a comparison between builds, not as promises: first paint varies by about 100 ms between runs.

## Measuring

```sh
pnpm run bench -- --repo /path/to/repo [--repo ...] [--counts 301,2001,5001] [--panel-counts 301,2001,5001]
```

It builds the plugin for production, then reports three tables per repository:

- **worker**: the built worker answering `loadCommits` (time, payload size, parts, peak memory).
- **layout**: the graph layout of those commits, with a fingerprint of the whole layout. The same
  fingerprint before and after a change means the same graph.
- **panel**: the built panel in headless Chrome, driven through the same `window.orca` shim and size
  limits as Orca's frame: first paint, DOM size, heap, how long opening a commit / an arrow key / a
  context menu take (to the next painted frame), and scrolling smoothness. An interaction cannot take less
  than about 33 ms, two frames.

`--only worker,layout,panel` picks sections; `--json file` keeps the results. `scripts/bench/cdp.mjs` and
`harness.mjs` are also a small way to drive the panel in a browser for other checks. Set `CHROME_PATH`
if Chrome is not where it expects.

## What was slow, and what was done

| Cost                                                               | Cause                                                                      | Change                                                                                 |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Every load took 1.3 s on vscode, whatever the count                | `git log --date-order` walks the whole history without a commit-graph file | The worker writes one in the background for a slow repository (a setting turns it off) |
| Opening a commit, arrow keys and menus grew with every "Load more" | One table row (about ten elements) per commit, all re-rendered             | Only the rows near the view are drawn                                                  |
| Layout grew with commits times branches                            | The search for the next branch started over each time                      | It resumes where it stopped; same graph                                                |
| Memory                                                             | The DOM held every row                                                     | Follows from drawing fewer rows                                                        |

Not changed, because it did not measure as a cost: moving the commits from the worker to the panel
(fetching 8 parts of a 5,001-commit answer took about 15 ms) and parsing them (about 40 ms for 27,000 commits).

## Results

Worker, first page of a vscode load (the cost is the history walk, so it is the same for any count before
the change):

| commits | before   | with a commit-graph |
| ------- | -------- | ------------------- |
| 301     | 1,406 ms | 179 ms              |
| 2,001   | 1,394 ms | 208 ms              |
| 5,001   | 1,465 ms | 273 ms              |
| 20,001  | 1,576 ms | 529 ms              |

What remains at 301 commits is mostly `git status` counting uncommitted files (about 150 ms there).

Layout, same graph (fingerprints equal): orca 13,543 commits 46.5 ms to 11.1 ms; vscode 20,001 commits
99.8 ms to 44.5 ms.

Panel on orca, before to after drawing only nearby rows:

| commits | open a commit | arrow key    | context menu | DOM elements     | heap         |
| ------- | ------------- | ------------ | ------------ | ---------------- | ------------ |
| 301     | 67 to 67 ms   | 33 to 33 ms  | 50 to 50 ms  | 3,397 to 1,728   | 5 to 3 MB    |
| 2,001   | 82 to 67 ms   | 40 to 33 ms  | 49 to 50 ms  | 18,814 to 1,728  | 21 to 3 MB   |
| 5,001   | 178 to 67 ms  | 94 to 33 ms  | 59 to 50 ms  | 46,407 to 1,728  | 49 to 5 MB   |
| 20,001  | 467 to 67 ms  | 270 to 33 ms | 189 to 50 ms | 129,019 to 1,546 | 134 to 10 MB |

Panel on the vscode clone, with the commit-graph in place, before to after:

| commits | first rows      | open a commit | arrow key    | DOM elements     | heap         |
| ------- | --------------- | ------------- | ------------ | ---------------- | ------------ |
| 5,001   | 830 to 556 ms   | 165 to 67 ms  | 102 to 33 ms | 46,299 to 1,361  | 50 to 6 MB   |
| 20,001  | 2,400 to 898 ms | 721 to 67 ms  | 460 to 33 ms | 185,019 to 1,178 | 199 to 22 MB |

At the default 301 commits first paint did not change beyond noise.
