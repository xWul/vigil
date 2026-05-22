import type { DiffLine, Hunk } from "./model/index.js";

interface MutableHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export function parseUnifiedDiff(patch: string): readonly Hunk[] {
  const hunks: Hunk[] = [];
  let current: MutableHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const rawLine of patch.split("\n")) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(rawLine);
    if (m) {
      if (current !== null) hunks.push(current);
      const oldStart = parseInt(m[1]!, 10);
      const oldCount = parseInt(m[2] ?? "1", 10);
      const newStart = parseInt(m[3]!, 10);
      const newCount = parseInt(m[4] ?? "1", 10);
      oldLine = oldStart;
      newLine = newStart;
      current = { oldStart, oldCount, newStart, newCount, lines: [] };
      continue;
    }

    if (current === null) continue;

    if (rawLine.startsWith("+")) {
      current.lines.push({
        kind: "added",
        content: rawLine.slice(1),
        oldLine: null,
        newLine: newLine++,
      });
    } else if (rawLine.startsWith("-")) {
      current.lines.push({
        kind: "removed",
        content: rawLine.slice(1),
        oldLine: oldLine++,
        newLine: null,
      });
    } else if (rawLine.startsWith(" ")) {
      current.lines.push({
        kind: "context",
        content: rawLine.slice(1),
        oldLine: oldLine++,
        newLine: newLine++,
      });
    }
  }

  if (current !== null) hunks.push(current);

  return hunks;
}
