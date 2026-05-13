import { ok } from "../../../shared/result.js";
import type { Result } from "../../../shared/result.js";
import type { CodeAnalyzer, Finding, ReviewContext, ReviewError } from "../CodeAnalyzer.js";

interface Pattern {
  regex: RegExp;
  title: string;
  description: string;
  severity: Finding["severity"];
}

const PATTERNS: Pattern[] = [
  {
    regex: /as\s+unknown\s+as\b/,
    title: "Double type cast (as unknown as)",
    description:
      "A double cast was added in this PR. This pattern bypasses the type system entirely and usually indicates a type mismatch that should be resolved rather than escaped.",
    severity: "medium",
  },
  {
    regex: /\bas\s+any\b/,
    title: "Type erasure (as any)",
    description:
      "An 'as any' cast was added in this PR. This removes all type safety for the expression. Add a proper type or use a type guard instead.",
    severity: "medium",
  },
  {
    regex: /@ts-ignore/,
    title: "TypeScript error suppression (@ts-ignore)",
    description:
      "A @ts-ignore directive was added in this PR. It silences a real compiler error without fixing it. Use @ts-expect-error with a justification comment, or fix the underlying type issue.",
    severity: "medium",
  },
  {
    regex: /@ts-expect-error/,
    title: "TypeScript expected error (@ts-expect-error)",
    description:
      "A @ts-expect-error directive was added in this PR. This is legitimate in test files but should include a comment explaining why the error is expected.",
    severity: "info",
  },
  {
    regex: /![.;,)\]]/,
    title: "Non-null assertion",
    description:
      "A non-null assertion operator (!) was added in this PR. This tells TypeScript to assume the value is never null or undefined. If that assumption is wrong, the result is a runtime error.",
    severity: "low",
  },
];

export class TypeSafetyAnalyzer implements CodeAnalyzer {
  readonly id = "type-safety" as const;

  analyze(context: ReviewContext): Promise<Result<readonly Finding[], ReviewError>> {
    const findings: Finding[] = [];

    for (const file of context.diff.files) {
      for (const hunk of file.hunks) {
        for (const line of hunk.lines) {
          if (line.kind !== "added") continue;

          for (const pattern of PATTERNS) {
            if (!pattern.regex.test(line.content)) continue;

            findings.push({
              severity: pattern.severity,
              title: pattern.title,
              description: pattern.description,
              evidence: line.content.trim(),
              file: file.newPath,
              lines: line.newLine !== null ? { start: line.newLine, end: line.newLine } : null,
              pass: "type-safety",
              source: "static",
            });
            break;
          }
        }
      }
    }

    return Promise.resolve(ok(findings));
  }
}
