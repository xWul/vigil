import { ok } from "../../../shared/result.js";
import type { Result } from "../../../shared/result.js";
import type { FileDiff } from "../../platforms/model/index.js";
import type { CodeAnalyzer, Finding, ReviewContext, ReviewError } from "../CodeAnalyzer.js";

type FileLabel = "behavior" | "refactor" | "test" | "config";

const TEST_PATTERN = /\.(test|spec)\.(ts|tsx|js|jsx)$/;
const CONFIG_PATTERN = /\.(json|yaml|yml|md|env)$|\.env\./;
const CONTROL_FLOW = /\b(if|else|while|for|switch|case|try|catch|throw|return|break|continue|yield|await)\b/;
const INTENT_KEYWORDS = /\b(refactor|rename|cleanup|clean\s+up|tidy|chore)\b/i;

function classifyFile(file: FileDiff): FileLabel {
  const path = file.newPath;

  if (TEST_PATTERN.test(path)) return "test";
  if (CONFIG_PATTERN.test(path)) return "config";

  // Deleted files: no hunks to scan, classify by path only
  if (file.status === "deleted") return "behavior";

  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.kind === "context") continue;
      if (CONTROL_FLOW.test(line.content)) return "behavior";
    }
  }

  return "refactor";
}

export class ChangeClassifierAnalyzer implements CodeAnalyzer {
  readonly id = "change-classification" as const;

  analyze(context: ReviewContext): Promise<Result<readonly Finding[], ReviewError>> {
    const counts = { behavior: 0, refactor: 0, test: 0, config: 0 };
    const behaviorFiles: string[] = [];

    for (const file of context.diff.files) {
      const label = classifyFile(file);
      counts[label]++;
      if (label === "behavior") behaviorFiles.push(file.newPath);
    }

    const findings: Finding[] = [];

    const summaryParts: string[] = [];
    if (counts.behavior > 0) summaryParts.push(`${counts.behavior} behavior`);
    if (counts.refactor > 0) summaryParts.push(`${counts.refactor} refactor-only`);
    if (counts.test > 0) summaryParts.push(`${counts.test} test`);
    if (counts.config > 0) summaryParts.push(`${counts.config} config`);

    const title =
      summaryParts.length > 0
        ? `Change breakdown: ${summaryParts.join(", ")}`
        : "Change breakdown: no files changed";

    const behaviorDetail =
      behaviorFiles.length > 0
        ? `Behavior files: ${behaviorFiles.join(", ")}. `
        : "";
    const refactorDetail = counts.refactor > 0 ? `Refactor-only: ${counts.refactor} files. ` : "";
    const testDetail = counts.test > 0 ? `Test: ${counts.test} files. ` : "";
    const configDetail = counts.config > 0 ? `Config: ${counts.config} files. ` : "";
    const caveat =
      "Note: classification is heuristic — rename-heavy PRs may show false behavior positives.";

    findings.push({
      severity: "info",
      title,
      description: `${behaviorDetail}${refactorDetail}${testDetail}${configDetail}${caveat}`.trim(),
      evidence: "",
      file: "",
      lines: null,
      pass: "change-classification",
      source: "static",
    });

    if (behaviorFiles.length > 0 && INTENT_KEYWORDS.test(context.pr.title)) {
      findings.push({
        severity: "medium",
        title: "Intent mismatch: PR describes a refactor but contains behavior changes",
        description: `The PR title suggests a refactor but ${behaviorFiles.length} file(s) contain control-flow changes: ${behaviorFiles.join(", ")}. Verify these changes are intentional. Note: classification is heuristic — rename-heavy diffs may trigger false positives.`,
        evidence: context.pr.title,
        file: "",
        lines: null,
        pass: "change-classification",
        source: "static",
      });
    }

    return Promise.resolve(ok(findings));
  }
}
