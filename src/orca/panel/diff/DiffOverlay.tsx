import { useEffect, useMemo, useState } from "preact/hooks";

import { closeDiff, openDiff } from "./diffStore";
import { parsePatch, toSideBySide, type DiffLine } from "./parsePatch";

type Mode = "unified" | "split";

const MODE_KEY = "git-graph.diffMode";

function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === "split" ? "split" : "unified";
  } catch {
    return "unified";
  }
}

function saveMode(mode: Mode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Storage can be blocked; the choice then lasts until the panel closes.
  }
}

/** Under this width two columns of code do not fit; the viewer is unified only. */
const NARROW = "(max-width: 560px)";

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);

  useEffect(() => {
    const query = window.matchMedia(NARROW);
    const update = () => setNarrow(query.matches);
    query.addEventListener("change", update);
    update();
    return () => query.removeEventListener("change", update);
  }, []);

  return narrow;
}

const MARKERS = { context: " ", add: "+", del: "-", note: "\\" } as const;

function UnifiedRow({ line }: { line: DiffLine }) {
  return (
    <tr class={`gg-diff__row gg-diff__row--${line.kind}`}>
      <td class="gg-diff__no">{line.oldNo}</td>
      <td class="gg-diff__no">{line.newNo}</td>
      <td class="gg-diff__text">
        <span class="gg-diff__marker">{MARKERS[line.kind]}</span>
        {line.text}
      </td>
    </tr>
  );
}

function SplitCell({ line, side }: { line: DiffLine | null; side: "left" | "right" }) {
  const kind = line === null ? "empty" : line.kind;
  const number = line === null ? null : side === "left" ? line.oldNo : line.newNo;
  return (
    <>
      <td class={`gg-diff__no gg-diff__row--${kind}`}>{number}</td>
      <td class={`gg-diff__text gg-diff__text--wrap gg-diff__row--${kind}`}>{line?.text}</td>
    </>
  );
}

/**
 * The diff viewer. VS Code opened a diff editor for "View Diff"; Orca has no such API, so the
 * panel shows the file's `git diff` itself, over the graph, until it is closed.
 */
export function DiffOverlay() {
  const diff = openDiff.value;
  const [chosen, setMode] = useState<Mode>(readMode);
  const narrow = useNarrow();
  // The person's choice is kept; a narrow panel only overrides it while it is narrow.
  const mode: Mode = narrow ? "unified" : chosen;
  const parsed = useMemo(() => (diff === null ? null : parsePatch(diff.patch)), [diff]);

  useEffect(() => {
    if (diff === null) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDiff();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [diff]);

  if (diff === null || parsed === null) {
    return null;
  }

  const choose = (next: Mode) => {
    setMode(next);
    saveMode(next);
  };
  const empty = parsed.hunks.length === 0;

  return (
    <div class="gg-diff" role="dialog" aria-modal="true" aria-label={diff.title}>
      <div class="gg-diff__bar">
        <div class="gg-diff__heading">
          <div class="gg-diff__title" title={diff.title}>
            {diff.title}
          </div>
          <div class="gg-diff__path" title={diff.newFilePath}>
            {diff.oldFilePath === diff.newFilePath
              ? diff.newFilePath
              : `${diff.oldFilePath} → ${diff.newFilePath}`}
          </div>
        </div>
        <div class="gg-diff__modes" role="group" aria-label="Diff layout" hidden={narrow}>
          <button
            type="button"
            class="gg-diff__btn"
            aria-pressed={mode === "unified"}
            onClick={() => choose("unified")}
          >
            Unified
          </button>
          <button
            type="button"
            class="gg-diff__btn"
            aria-pressed={mode === "split"}
            onClick={() => choose("split")}
          >
            Side by side
          </button>
        </div>
        <button type="button" class="gg-diff__btn" onClick={closeDiff} autoFocus>
          Close
        </button>
      </div>

      <div class="gg-diff__body">
        {parsed.meta.map((line) => (
          <div class="gg-diff__notice" key={line}>
            {line}
          </div>
        ))}
        {parsed.binary && (
          <div class="gg-diff__notice">Binary file: there is no text to compare.</div>
        )}
        {empty && !parsed.binary && (
          <div class="gg-diff__notice">There are no changes to show for this file.</div>
        )}
        {diff.truncated && (
          <div class="gg-diff__notice gg-diff__notice--warn">
            This diff is very large and has been cut short.
          </div>
        )}

        {parsed.hunks.map((hunk) => (
          <table class={`gg-diff__table gg-diff__table--${mode}`} key={hunk.header}>
            <tbody>
              <tr class="gg-diff__hunk">
                <td colSpan={mode === "unified" ? 3 : 4}>{hunk.header}</td>
              </tr>
              {mode === "unified"
                ? hunk.lines.map((line, index) => <UnifiedRow line={line} key={index} />)
                : toSideBySide(hunk.lines).map((row, index) => (
                    <tr key={index}>
                      <SplitCell line={row.left} side="left" />
                      <SplitCell line={row.right} side="right" />
                    </tr>
                  ))}
            </tbody>
          </table>
        ))}
      </div>
    </div>
  );
}
