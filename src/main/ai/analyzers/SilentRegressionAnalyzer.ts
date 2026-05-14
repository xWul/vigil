import { ok } from "../../../shared/result.js";
import type { Result } from "../../../shared/result.js";
import type { DiffLine, FileDiff, Hunk } from "../../platforms/model/index.js";
import type { CodeAnalyzer, Finding, ReviewContext, ReviewError } from "../CodeAnalyzer.js";

const TS_JS = /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/;

// ---------------------------------------------------------------------------
// Paired hunk analysis helper
// ---------------------------------------------------------------------------

interface ChangePair {
  readonly removed: readonly DiffLine[];
  readonly added: readonly DiffLine[];
}

function extractChangePairs(hunk: Hunk): ChangePair[] {
  const pairs: ChangePair[] = [];
  const lines = hunk.lines;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.kind === "context") {
      i++;
      continue;
    }

    const removed: DiffLine[] = [];
    while (i < lines.length && lines[i]!.kind === "removed") {
      removed.push(lines[i++]!);
    }
    const added: DiffLine[] = [];
    while (i < lines.length && lines[i]!.kind === "added") {
      added.push(lines[i++]!);
    }

    if (removed.length > 0 || added.length > 0) {
      pairs.push({ removed, added });
    }
  }

  return pairs;
}

function diffEvidence(removed: readonly DiffLine[], added: readonly DiffLine[]): string {
  const removedLines = removed.map((l) => `- ${l.content.trim()}`).join("\n");
  const addedLines = added.map((l) => `+ ${l.content.trim()}`).join("\n");
  return [removedLines, addedLines].filter(Boolean).join("\n");
}

function firstNewLine(lines: readonly DiffLine[]): number | null {
  for (const l of lines) {
    if (l.newLine !== null) return l.newLine;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Detector 1: Condition operator changes
// ---------------------------------------------------------------------------

const CONDITIONAL_MARKER = /\bif\s*\(|}\s*else\s+if\s*\(|\bwhile\s*\(|\bfor\s*\(| \? .+ : /;
const OPERATORS_RE = /[><!]=?=?|&&|\|\|/g;

const RISKY_PAIRS: ReadonlyMap<string, { to: string; description: string }[]> = new Map([
  [
    ">=",
    [
      {
        to: "===",
        description:
          "Values above the limit no longer trigger — potential infinite loop or missed boundary.",
      },
      {
        to: ">",
        description: "The boundary value is now excluded where it was previously included.",
      },
    ],
  ],
  [
    "<=",
    [
      {
        to: "===",
        description:
          "Values below the limit no longer trigger — potential infinite loop or missed boundary.",
      },
      {
        to: "<",
        description: "The boundary value is now excluded where it was previously included.",
      },
    ],
  ],
  [
    ">",
    [
      {
        to: ">=",
        description: "The boundary value is now included where it was previously excluded.",
      },
    ],
  ],
  [
    "<",
    [
      {
        to: "<=",
        description: "The boundary value is now included where it was previously excluded.",
      },
    ],
  ],
  [
    "!==",
    [
      {
        to: "===",
        description:
          "The condition is now the logical opposite of the original — equality where inequality was intended.",
      },
    ],
  ],
  [
    "!=",
    [
      {
        to: "==",
        description:
          "The condition is now the logical opposite of the original — equality where inequality was intended.",
      },
    ],
  ],
  [
    "&&",
    [
      {
        to: "||",
        description:
          "Logic changed from AND to OR — the condition now passes when either operand is truthy instead of both.",
      },
    ],
  ],
  [
    "||",
    [
      {
        to: "&&",
        description:
          "Logic changed from OR to AND — the condition now requires both operands to be truthy instead of either.",
      },
    ],
  ],
]);

function tokenSimilarity(a: string, b: string): number {
  const stripped = (s: string) =>
    s.replace(OPERATORS_RE, " ").replace(/\s+/g, " ").trim().split(" ");
  const ta = stripped(a);
  const tb = stripped(b);
  const longer = Math.max(ta.length, tb.length);
  if (longer === 0) return 1;
  let matches = 0;
  const bSet = new Set(tb);
  for (const t of ta) {
    if (bSet.has(t)) matches++;
  }
  return matches / longer;
}

function extractOperators(line: string): string[] {
  return [...line.matchAll(/(!==|!=|===|==|>=|<=|>|<|&&|\|\|)/g)].map((m) => m[0]);
}

function detectConditionChanges(file: FileDiff): Finding[] {
  const findings: Finding[] = [];

  for (const hunk of file.hunks) {
    for (const pair of extractChangePairs(hunk)) {
      if (pair.removed.length !== 1 || pair.added.length !== 1) continue;
      const rem = pair.removed[0]!;
      const add = pair.added[0]!;

      const combinedText = rem.content + " " + add.content;
      if (!CONDITIONAL_MARKER.test(combinedText)) continue;
      if (tokenSimilarity(rem.content, add.content) < 0.7) continue;

      const oldOps = extractOperators(rem.content);
      const newOps = extractOperators(add.content);

      for (const oldOp of oldOps) {
        const targets = RISKY_PAIRS.get(oldOp);
        if (!targets) continue;
        for (const { to, description } of targets) {
          if (newOps.includes(to) && !oldOps.includes(to)) {
            findings.push({
              severity: "high",
              title: `Condition operator changed: ${oldOp} → ${to}`,
              description,
              evidence: diffEvidence(pair.removed, pair.added),
              file: file.newPath,
              lines: (() => {
                const n = firstNewLine(pair.added);
                return n !== null ? { start: n, end: n } : null;
              })(),
              pass: "regression",
              source: "static",
            });
            break;
          }
        }
      }
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Detector 2: Error handling removal or change
// ---------------------------------------------------------------------------

const CATCH_RE = /\bcatch\s*\(/;
const FALLBACK_RETURN_RE = /\breturn\s+(null|undefined|false|\[\]|\{\})\s*;?/;
const THROW_RE = /\bthrow\b/;

function detectErrorHandlingChanges(file: FileDiff): Finding[] {
  const findings: Finding[] = [];

  for (const hunk of file.hunks) {
    const removedLines = hunk.lines.filter((l) => l.kind === "removed");
    const addedLines = hunk.lines.filter((l) => l.kind === "added");

    const removedHasCatch = removedLines.some((l) => CATCH_RE.test(l.content));
    const addedHasCatch = addedLines.some((l) => CATCH_RE.test(l.content));

    // Pattern A: catch block removed
    if (removedHasCatch && !addedHasCatch) {
      const catchLine = removedLines.find((l) => CATCH_RE.test(l.content))!;
      findings.push({
        severity: "high",
        title: "Catch block removed",
        description:
          "A catch block was removed. Errors that were previously handled will now propagate to callers. Check all call sites.",
        evidence: `- ${catchLine.content.trim()}`,
        file: file.newPath,
        lines: null,
        pass: "regression",
        source: "static",
      });
      continue;
    }

    // Pattern B: return fallback → throw in catch context
    const catchIdx = hunk.lines.findIndex((l) => CATCH_RE.test(l.content));
    if (catchIdx === -1) continue;

    const windowLines = hunk.lines.slice(catchIdx, catchIdx + 8);
    const fallbackLine = windowLines.find(
      (l) => l.kind === "removed" && FALLBACK_RETURN_RE.test(l.content),
    );
    const throwLine = windowLines.find((l) => l.kind === "added" && THROW_RE.test(l.content));

    if (fallbackLine && throwLine) {
      findings.push({
        severity: "high",
        title: "Error handling changed: now throws instead of returning fallback",
        description:
          "A catch block that previously returned a safe fallback value now throws. Callers that do not handle this error will crash.",
        evidence: diffEvidence([fallbackLine], [throwLine]),
        file: file.newPath,
        lines: (() => {
          const n = throwLine.newLine;
          return n !== null ? { start: n, end: n } : null;
        })(),
        pass: "regression",
        source: "static",
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Detector 3: Numeric constant changes in sensitive contexts
// ---------------------------------------------------------------------------

const SENSITIVITY_KEYWORDS =
  /timeout|retr(y|ies)|delay|interval|limit|threshold|attempts|backoff|ttl|expir|duration|wait/i;
const NUMBER_RE = /\b(\d+(?:\.\d+)?)\b/g;

function extractNumbers(line: string): number[] {
  return [...line.matchAll(NUMBER_RE)].map((m) => Number(m[1]!));
}

function sensitivityKeyword(text: string): string | null {
  const m = SENSITIVITY_KEYWORDS.exec(text);
  return m ? m[0] : null;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function detectNumericChanges(file: FileDiff): Finding[] {
  const findings: Finding[] = [];

  for (const hunk of file.hunks) {
    for (const pair of extractChangePairs(hunk)) {
      if (pair.removed.length !== 1 || pair.added.length !== 1) continue;
      const rem = pair.removed[0]!;
      const add = pair.added[0]!;

      const oldNums = extractNumbers(rem.content);
      const newNums = extractNumbers(add.content);
      if (oldNums.length === 0 || newNums.length === 0) continue;

      const oldVal = oldNums[0]!;
      const newVal = newNums[0]!;
      if (oldVal === newVal) continue;

      const keyword = sensitivityKeyword(rem.content + " " + add.content);
      if (!keyword) continue;

      const ratio = newVal / oldVal;
      const direction =
        newVal > oldVal ? `increased ${ratio > 1 ? `${ratio.toFixed(1)}×` : ""}` : "decreased";

      findings.push({
        severity: "medium",
        title: `${capitalise(keyword)} value changed: ${oldVal} → ${newVal}`,
        description: `${capitalise(keyword)} ${direction} from ${oldVal} to ${newVal}. Verify this is intentional and that downstream systems handle the new value correctly.`,
        evidence: diffEvidence(pair.removed, pair.added),
        file: file.newPath,
        lines: (() => {
          const n = firstNewLine(pair.added);
          return n !== null ? { start: n, end: n } : null;
        })(),
        pass: "regression",
        source: "static",
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Detector 4: Async execution pattern changes
// ---------------------------------------------------------------------------

const AWAIT_RE = /\bawait\b/;
const PROMISE_COMBINATOR_RE = /Promise\.(all|allSettled|race|any)\s*\(/;

function detectAsyncPatternChanges(file: FileDiff): Finding[] {
  const findings: Finding[] = [];

  for (const hunk of file.hunks) {
    const removedLines = hunk.lines.filter((l) => l.kind === "removed");
    const addedLines = hunk.lines.filter((l) => l.kind === "added");

    const removedAwaitCount = removedLines.filter((l) => AWAIT_RE.test(l.content)).length;
    if (removedAwaitCount < 2) continue;

    const combinatorLine = addedLines.find((l) => PROMISE_COMBINATOR_RE.test(l.content));
    if (!combinatorLine) continue;

    const match = PROMISE_COMBINATOR_RE.exec(combinatorLine.content)!;
    const combinator = `Promise.${match[1]!}`;

    const semanticsNote: Record<string, string> = {
      all: "Rejects immediately if any promise rejects.",
      allSettled:
        "Never rejects — all results (fulfilled or rejected) are available. Check for rejected entries explicitly.",
      race: "Resolves or rejects with the first settled promise. Later results are ignored.",
      any: "Rejects only if all promises reject. First fulfillment wins.",
    };
    const note = semanticsNote[match[1]!] ?? "";

    const awaitLines = removedLines.filter((l) => AWAIT_RE.test(l.content));
    findings.push({
      severity: "medium",
      title: `Sequential await replaced by ${combinator}`,
      description:
        `Execution order changed from sequential to parallel. Verify there are no ordering dependencies between the operations and that error handling covers partial failures. ${note}`.trim(),
      evidence: diffEvidence(awaitLines, [combinatorLine]),
      file: file.newPath,
      lines: (() => {
        const n = combinatorLine.newLine;
        return n !== null ? { start: n, end: n } : null;
      })(),
      pass: "regression",
      source: "static",
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Detector 5: Side effect introductions
// ---------------------------------------------------------------------------

interface SideEffectPattern {
  regex: RegExp;
  label: string;
  description: string;
}

const SIDE_EFFECT_PATTERNS: SideEffectPattern[] = [
  {
    regex: /localStorage[.[]/,
    label: "localStorage write",
    description:
      "A new localStorage access was introduced. This persists data to the browser's local storage — verify the key, value shape, and any privacy implications.",
  },
  {
    regex: /sessionStorage[.[]/,
    label: "sessionStorage write",
    description:
      "A new sessionStorage access was introduced. This persists data for the current browser session — verify the key and value shape.",
  },
  {
    regex: /document\.cookie/,
    label: "cookie access",
    description:
      "A new document.cookie access was introduced. Cookies are sent with every request to the domain — verify the name, value, expiry, and security flags.",
  },
  {
    regex: /indexedDB\./,
    label: "IndexedDB access",
    description:
      "A new IndexedDB access was introduced. This writes to persistent browser storage — verify the database name, object store, and transaction type.",
  },
  {
    regex: /\bfs\.(writeFile|appendFile|writeFileSync)\s*\(/,
    label: "file write",
    description:
      "A new file write operation was introduced. Verify the target path, content, and error handling.",
  },
  {
    regex: /\bfs\.(rmSync|unlinkSync)\s*\(/,
    label: "file deletion",
    description:
      "A new file deletion operation was introduced. Verify the target path and that deletion is safe under concurrent access.",
  },
];

function detectSideEffectIntroductions(file: FileDiff): Finding[] {
  const findings: Finding[] = [];

  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.kind !== "added") continue;

      for (const pattern of SIDE_EFFECT_PATTERNS) {
        if (!pattern.regex.test(line.content)) continue;

        findings.push({
          severity: "medium",
          title: `New side effect: ${pattern.label}`,
          description: pattern.description,
          evidence: `+ ${line.content.trim()}`,
          file: file.newPath,
          lines: line.newLine !== null ? { start: line.newLine, end: line.newLine } : null,
          pass: "regression",
          source: "static",
        });
        break;
      }
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// SilentRegressionAnalyzer
// ---------------------------------------------------------------------------

const DETECTORS = [
  detectConditionChanges,
  detectErrorHandlingChanges,
  detectNumericChanges,
  detectAsyncPatternChanges,
  detectSideEffectIntroductions,
];

export class SilentRegressionAnalyzer implements CodeAnalyzer {
  readonly id = "regression" as const;

  analyze(context: ReviewContext): Promise<Result<readonly Finding[], ReviewError>> {
    const findings: Finding[] = [];

    for (const file of context.diff.files) {
      if (file.status === "deleted") continue;
      if (!TS_JS.test(file.newPath)) continue;

      for (const detect of DETECTORS) {
        try {
          findings.push(...detect(file));
        } catch {
          // individual detector failures are silent
        }
      }
    }

    return Promise.resolve(ok(findings));
  }
}
