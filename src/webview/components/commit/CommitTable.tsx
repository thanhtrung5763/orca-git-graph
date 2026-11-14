import { Fragment } from "preact";
import { useLayoutEffect, useMemo, useState } from "preact/hooks";

import type { GitCommitNode } from "@/backend/types";
import { CommitDetails } from "@/webview/components/commit/CommitDetails";
import { CommitGraph } from "@/webview/components/commit/CommitGraph";
import { CommitRow } from "@/webview/components/commit/CommitRow";
import type { ColumnResize } from "@/webview/components/commit/useColumnResize";
import { useColumnResize } from "@/webview/components/commit/useColumnResize";
import {
  COMMIT_DETAILS_HEIGHT,
  TABLE_HEADER_HEIGHT,
  UNCOMMITTED_CHANGES
} from "@/webview/constants";
import { GRAPH_PADDING } from "@/webview/graph/constants";
import { computeGraphLayout } from "@/webview/graph/layout";
import { branchColour } from "@/webview/graph/palette";
import type { GraphExpansion } from "@/webview/graph/types";
import { graphWidth } from "@/webview/graph/utils";
import { toggleCommitDetails } from "@/webview/lib/actions";
import { columnWidths, commitDetails, expandedCommit } from "@/webview/lib/stores";
import { fitColumns } from "@/webview/utils/columnFit";
import { getCommitDate } from "@/webview/utils/date";
import { planRows, visibleWindow, type RowWindow } from "@/webview/utils/rowWindow";

type CommitTableProps = {
  commits: Array<GitCommitNode>;
  head: string | null;
  headBranch: string | null;
};

const HEADER_CLASS =
  "relative h-8 overflow-hidden border-b border-line px-3 text-left font-semibold" +
  " text-ellipsis whitespace-nowrap";

const HANDLE_CLASS = "absolute top-0 h-full w-1.5 cursor-col-resize";

/** Distance over which the graph fades out, where the column cuts it off. */
const GRAPH_FADE = 12;

const GRAPH_CLIP =
  `width: var(--col-graph); top: ${TABLE_HEADER_HEIGHT}px;` +
  ` mask-image: linear-gradient(to right, black calc(100% - ${GRAPH_FADE}px), transparent)`;

/** Rows drawn on the first render, before the table has been measured against the view. */
const FIRST_ROWS = 100;

/** Keep room for the graph, and for the column title when the graph is narrow. */
const MIN_GRAPH_COLUMN = 64;

/**
 * Grip that moves the boundary after column `boundary`. Both columns of a
 * boundary hold one, because a header cuts off what leaves it. The right one
 * draws the line between the two columns, the left one only widens the grip.
 */
function ResizeHandle({
  boundary,
  side,
  resize
}: {
  boundary: number;
  side: "left" | "right";
  resize: ColumnResize;
}) {
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      tabIndex={side === "left" ? 0 : undefined}
      class={`${HANDLE_CLASS} ${side === "left" ? "left-0 border-l border-line-soft" : "right-0"}`}
      onMouseDown={(event) => resize.startResize(boundary, event)}
      onKeyDown={(event) => resize.nudge(boundary, event)}
    />
  );
}

export function CommitTable({ commits, head, headBranch }: CommitTableProps) {
  const layout = useMemo(() => computeGraphLayout(commits, head), [commits, head]);
  const messages = useMemo(
    () => new Map(commits.map((commit) => [commit.hash, commit.message])),
    [commits]
  );
  const graphColumn = Math.max(graphWidth(layout) + GRAPH_PADDING, MIN_GRAPH_COLUMN);
  const resize = useColumnResize(graphColumn);
  const sized = columnWidths.value !== null;

  const expandedHash = expandedCommit.value;
  const expandedRow = commits.findIndex((commit) => commit.hash === expandedHash);
  const expansion: GraphExpansion | null =
    expandedRow === -1 ? null : { row: expandedRow, height: COMMIT_DETAILS_HEIGHT };

  /**
   * Only the rows near the view are drawn, with blank rows standing in for the rest, because a row costs
   * about ten elements and a history of thousands of commits made opening a commit, or a menu, wait
   * for all of them. The rows are exactly `ROW_HEIGHT` high, so where each one belongs is arithmetic.
   */
  const [rows, setRows] = useState<RowWindow>({
    start: 0,
    end: Math.min(commits.length, FIRST_ROWS)
  });

  /**
   * The width the date and author columns need for every commit, not only the drawn ones: the browser
   * would size them from the drawn rows, and they would change width as the rows scrolled by. The font
   * is that of a drawn cell, and the text of all commits is measured once per load.
   */
  const [fit, setFit] = useState<{ date: number; author: number } | null>(null);
  useLayoutEffect(() => {
    const cell = resize.containerRef.current?.querySelector("tbody td:nth-child(3)");
    const context = document.createElement("canvas").getContext("2d");
    if (cell === null || cell === undefined || context === null) {
      return;
    }

    context.font = getComputedStyle(cell).font;
    setFit(
      fitColumns({
        dates: commits.map((commit) => getCommitDate(commit.date).value),
        authors: commits.map((commit) => commit.author),
        measure: (text) => context.measureText(text).width
      })
    );
  }, [commits, resize.containerRef]);
  // Columns the person has sized are sized by their widths, not by the text.
  const minWidths = sized ? null : fit;

  useLayoutEffect(() => {
    const container = resize.containerRef.current;
    if (container === null) {
      return;
    }

    let frame = 0;
    const update = () => {
      frame = 0;
      const next = visibleWindow({
        // How far the first row is above the top of the view.
        scrollTop: -container.getBoundingClientRect().top - TABLE_HEADER_HEIGHT,
        viewportHeight: window.innerHeight,
        count: commits.length,
        expandedRow
      });
      setRows((current) =>
        current.start === next.start && current.end === next.end ? current : next
      );
    };
    const schedule = () => {
      if (frame === 0) {
        frame = requestAnimationFrame(update);
      }
    };

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [commits.length, expandedRow, resize.containerRef]);

  const titles = [
    window.l10n.graph,
    window.l10n.description,
    window.l10n.date,
    window.l10n.author,
    window.l10n.commit
  ];

  return (
    <div class="relative" ref={resize.containerRef}>
      <div class="pointer-events-none absolute left-0 overflow-hidden" style={GRAPH_CLIP}>
        <CommitGraph layout={layout} expansion={expansion} rows={rows} />
      </div>
      <table
        class={`w-full cursor-default border-collapse text-ui select-none ${
          sized ? "table-fixed" : ""
        }`}
      >
        <colgroup>
          <col style="width: var(--col-graph)" />
          <col />
          <col style="width: var(--col-date)" />
          <col style="width: var(--col-author)" />
          <col style="width: var(--col-commit)" />
        </colgroup>
        <thead>
          <tr ref={resize.headRef} class={resize.resizing ? "cursor-col-resize" : ""}>
            {titles.map((title, index) => (
              <th
                key={title}
                class={HEADER_CLASS}
                style={
                  minWidths !== null && index === 2
                    ? `min-width: ${minWidths.date}px`
                    : minWidths !== null && index === 3
                      ? `min-width: ${minWidths.author}px`
                      : undefined
                }
              >
                {index > 0 && <ResizeHandle boundary={index - 1} side="left" resize={resize} />}
                {title}
                {index < titles.length - 1 && (
                  <ResizeHandle boundary={index} side="right" resize={resize} />
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {planRows(commits.length, rows, expandedRow).map((item, position) => {
            if (item.kind === "spacer") {
              return (
                <tr key={`gap-${position}`} aria-hidden="true" style={`height: ${item.height}px`}>
                  <td colSpan={5} class="p-0" />
                </tr>
              );
            }

            const commit = commits[item.index];
            if (commit === undefined) {
              return null;
            }
            return (
              <Fragment key={commit.hash}>
                <CommitRow
                  commit={commit}
                  isHead={commit.hash === head}
                  headBranch={headBranch}
                  messages={messages}
                  colour={branchColour(layout.vertices[item.index]?.colour ?? 0)}
                  expanded={item.index === expandedRow}
                  onSelect={
                    commit.hash === UNCOMMITTED_CHANGES
                      ? undefined
                      : () => toggleCommitDetails(commit.hash)
                  }
                />
                {item.index === expandedRow && <CommitDetails details={commitDetails.value} />}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
