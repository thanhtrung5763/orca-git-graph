export type DiffLine =
  | { kind: "context"; oldNo: number; newNo: number; text: string }
  | { kind: "add"; oldNo: null; newNo: number; text: string }
  | { kind: "del"; oldNo: number; newNo: null; text: string }
  /** `\ No newline at end of file`. */
  | { kind: "note"; oldNo: null; newNo: null; text: string };

export type DiffHunk = { header: string; lines: DiffLine[] };

export type ParsedPatch = {
  /** What `git diff` says about the file besides its lines: renames, mode changes, ... */
  meta: string[];
  hunks: DiffHunk[];
  binary: boolean;
};

export type SideRow = { left: DiffLine | null; right: DiffLine | null };

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
/** Extended header lines worth showing; `diff --git`, `index`, `---` and `+++` only repeat the path. */
const META_LINE =
  /^(old mode|new mode|deleted file mode|new file mode|rename from|rename to|copy from|copy to|similarity index|dissimilarity index)\b/;

/** Parses the output of `git diff` for one file. */
export function parsePatch(patch: string): ParsedPatch {
  const meta: string[] = [];
  const hunks: DiffHunk[] = [];
  let binary = false;
  let current: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  const rows = patch.split("\n");
  if (rows.at(-1) === "") {
    rows.pop();
  }

  for (const row of rows) {
    const header = HUNK_HEADER.exec(row);
    if (header !== null) {
      oldNo = Number(header[1]);
      newNo = Number(header[2]);
      current = { header: row, lines: [] };
      hunks.push(current);
      continue;
    }

    if (current === null) {
      if (row.startsWith("Binary files ") || row.startsWith("GIT binary patch")) {
        binary = true;
      } else if (META_LINE.test(row)) {
        meta.push(row);
      }
      continue;
    }

    const marker = row[0];
    const text = row.slice(1);
    if (marker === "+") {
      current.lines.push({ kind: "add", oldNo: null, newNo: newNo++, text });
    } else if (marker === "-") {
      current.lines.push({ kind: "del", oldNo: oldNo++, newNo: null, text });
    } else if (marker === "\\") {
      current.lines.push({ kind: "note", oldNo: null, newNo: null, text: row.slice(2) });
    } else {
      // A context line, or an empty one whose leading space was trimmed.
      current.lines.push({ kind: "context", oldNo: oldNo++, newNo: newNo++, text });
    }
  }

  return { meta, hunks, binary };
}

/** Lays a hunk out in two columns: each run of removed lines beside the run of added ones. */
export function toSideBySide(lines: readonly DiffLine[]): SideRow[] {
  const rows: SideRow[] = [];
  let removed: DiffLine[] = [];
  let added: DiffLine[] = [];

  const flush = () => {
    const height = Math.max(removed.length, added.length);
    for (let index = 0; index < height; index++) {
      rows.push({ left: removed[index] ?? null, right: added[index] ?? null });
    }
    removed = [];
    added = [];
  };

  for (const line of lines) {
    if (line.kind === "del") {
      removed.push(line);
    } else if (line.kind === "add") {
      added.push(line);
    } else {
      flush();
      rows.push({ left: line, right: line });
    }
  }
  flush();

  return rows;
}
