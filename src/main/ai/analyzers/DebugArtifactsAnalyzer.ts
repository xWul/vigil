import type { ResolvedAnalyzerConfig } from "../../../shared/analyzer-config.js";
import { DEFAULT_ANALYZER_CONFIG } from "../../../shared/analyzer-config.js";
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
    regex: /console\.(log|error|warn|debug|info)\s*\(/,
    title: "Debug console call",
    description:
      "A console method was added in this PR. Use the injected Logger interface instead of console calls in application code.",
    severity: "low",
  },
  {
    regex: /\bdebugger\b/,
    title: "Debugger statement",
    description:
      "A debugger statement was added in this PR. It causes a hard stop in any environment with DevTools open and must not ship.",
    severity: "medium",
  },
  {
    regex: /\b(TODO|FIXME|HACK|XXX):?(\s|$)/,
    title: "Unresolved debt marker",
    description:
      "A debt marker was added in this PR. Surfaced for reviewer visibility — address or link to a tracking issue before merging if blocking.",
    severity: "info",
  },
];

type DebugArtifactsConfig = ResolvedAnalyzerConfig["analyzers"]["debugArtifacts"];

export class DebugArtifactsAnalyzer implements CodeAnalyzer {
  readonly id = "debug-artifacts" as const;
  private readonly cfg: DebugArtifactsConfig;

  constructor(config?: DebugArtifactsConfig) {
    this.cfg = config ?? DEFAULT_ANALYZER_CONFIG.analyzers.debugArtifacts;
  }

  analyze(context: ReviewContext): Promise<Result<readonly Finding[], ReviewError>> {
    if (!this.cfg.enabled) return Promise.resolve(ok([]));

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
              pass: "debug-artifacts",
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
