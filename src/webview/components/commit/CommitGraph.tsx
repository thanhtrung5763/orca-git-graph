import { useMemo } from "preact/hooks";

import { VERTEX_RADIUS } from "@/webview/graph/constants";
import { branchColour, UNCOMMITTED_COLOUR } from "@/webview/graph/palette";
import { branchStrokes } from "@/webview/graph/strokes";
import type { GraphBranch, GraphExpansion, GraphLayout } from "@/webview/graph/types";
import { expandOffset, graphHeight, graphWidth, laneX, rowY } from "@/webview/graph/utils";
import { getWebviewConfig } from "@/webview/lib/webview-config";
import type { RowWindow } from "@/webview/utils/rowWindow";

const SHADOW_CLASS = "fill-none stroke-editor/75 stroke-4";
const LINE_CLASS = "fill-none stroke-2";
const HEAD_DOT_CLASS = "fill-editor stroke-2";
const DOT_CLASS = "stroke-editor/75 stroke-1";

/**
 * The lines of a branch that come near rows `start` to `end`. A line runs down from `p1` to `p2`, so
 * it is near when it starts before the end and finishes after the start; one that spans the whole
 * window with both ends outside it is kept, and drawn in full.
 */
function nearRows(branch: GraphBranch, start: number, end: number): GraphBranch {
  return {
    ...branch,
    lines: branch.lines.filter((line) => line.p2.y >= start - 1 && line.p1.y <= end)
  };
}

/**
 * The branch lines and commit dots, drawn behind the first column of the commit
 * table. The table rows set the scale: a row is `ROW_HEIGHT` high. The caller
 * places the graph, and cuts it off when the column is too narrow for it.
 */
export function CommitGraph({
  layout,
  expansion,
  rows
}: {
  layout: GraphLayout;
  expansion: GraphExpansion | null;
  /** The rows the table draws. The graph keeps its full height but draws only what is near them. */
  rows: RowWindow;
}) {
  const angular = getWebviewConfig().graphStyle === "angular";
  // The table makes a new `expansion` object each time it renders, and renders when a commit's details
  // arrive, which leaves the graph as it was. What the object holds decides the drawing.
  const row = expansion?.row;
  const height = expansion?.height;

  const drawing = useMemo(() => {
    const open: GraphExpansion | null =
      row === undefined || height === undefined ? null : { row, height };
    const strokes = layout.branches.flatMap((branch) =>
      branchStrokes(nearRows(branch, rows.start, rows.end), angular, open)
    );

    return {
      width: graphWidth(layout),
      height: graphHeight(layout, open),
      body: (
        <>
          {strokes.map((stroke, index) => (
            <g key={index}>
              <path class={SHADOW_CLASS} d={stroke.path} />
              <path
                class={LINE_CLASS}
                d={stroke.path}
                stroke={stroke.isCommitted ? branchColour(stroke.colour) : UNCOMMITTED_COLOUR}
              />
            </g>
          ))}
          {layout.vertices.slice(rows.start, rows.end).map((vertex) => {
            const colour = vertex.isCommitted ? branchColour(vertex.colour) : UNCOMMITTED_COLOUR;

            return (
              <circle
                key={vertex.y}
                cx={laneX(vertex.x)}
                cy={rowY(vertex.y) + expandOffset(vertex.y, open)}
                r={VERTEX_RADIUS}
                class={vertex.isCurrent ? HEAD_DOT_CLASS : DOT_CLASS}
                stroke={vertex.isCurrent ? colour : undefined}
                fill={vertex.isCurrent ? undefined : colour}
              />
            );
          })}
        </>
      )
    };
  }, [layout, angular, row, height, rows.start, rows.end]);

  return (
    <svg class="block" width={drawing.width} height={drawing.height} aria-hidden="true">
      {drawing.body}
    </svg>
  );
}
