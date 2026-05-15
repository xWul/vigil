import { ok } from "../../../shared/result.js";
import type { Result } from "../../../shared/result.js";
import type { CodeAnalyzer, Finding, ReviewContext, ReviewError } from "../CodeAnalyzer.js";

const WINDOW_SIZE = 6;
const MIN_LINE_LENGTH = 10;

// Module-level declarations that appear verbatim across many files — not logic worth flagging.
const STRUCTURAL_LINE_RE = /^(import\s|export\s*(\{|type\s*[\w{]|\*\s+from|default\s+[A-Za-z_$]))/;

function hashLines(lines: readonly string[]): string {
  return lines.join("\n");
}

interface Block {
  readonly file: string;
  readonly startLine: number;
  readonly lines: readonly string[];
}

function extractBlocks(filePath: string, content: string): Block[] {
  const rawLines = content.split("\n");
  const meaningfulLines = rawLines
    .map((line, i) => ({ line: line.trim(), original: i + 1 }))
    .filter(
      (l) =>
        l.line.length >= MIN_LINE_LENGTH &&
        !l.line.startsWith("//") &&
        !STRUCTURAL_LINE_RE.test(l.line),
    );

  const blocks: Block[] = [];
  for (let i = 0; i <= meaningfulLines.length - WINDOW_SIZE; i++) {
    const window = meaningfulLines.slice(i, i + WINDOW_SIZE);
    blocks.push({
      file: filePath,
      startLine: window[0]!.original,
      lines: window.map((l) => l.line),
    });
  }
  return blocks;
}

export class DuplicationAnalyzer implements CodeAnalyzer {
  readonly id = "duplication" as const;

  analyze(context: ReviewContext): Promise<Result<readonly Finding[], ReviewError>> {
    const allBlocks: Block[] = [];

    for (const file of context.diff.files) {
      if (file.status === "deleted") continue;
      const content = context.files.get(file.newPath);
      if (!content) continue;
      allBlocks.push(...extractBlocks(file.newPath, content));
    }

    const seen = new Map<string, Block>();
    const reported = new Set<string>();
    const findings: Finding[] = [];

    for (const block of allBlocks) {
      const key = hashLines(block.lines);
      const prior = seen.get(key);

      if (prior) {
        const reportKey = `${prior.file}:${prior.startLine}`;
        if (!reported.has(reportKey)) {
          reported.add(reportKey);
          const sameFile = prior.file === block.file;
          findings.push({
            severity: "low",
            title: `Duplicated block (${WINDOW_SIZE}+ lines)`,
            description: sameFile
              ? `A block of ${WINDOW_SIZE} or more lines appears multiple times in ${block.file}. Extract the repeated logic into a shared function.`
              : `A block of ${WINDOW_SIZE} or more lines is duplicated between ${prior.file} and ${block.file}. Extract the shared logic into a common module.`,
            evidence: block.lines.slice(0, 3).join("\n"),
            file: prior.file,
            lines: { start: prior.startLine, end: prior.startLine + WINDOW_SIZE - 1 },
            pass: "duplication",
            source: "static",
          });
        }
      } else {
        seen.set(key, block);
      }
    }

    return Promise.resolve(ok(findings));
  }
}
