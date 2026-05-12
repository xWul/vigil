import type { Result } from "../../shared/result.js";
import type { Diff, PullRequest } from "../platforms/model/index.js";

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type FindingPass =
  | "correctness"
  | "security"
  | "consistency"
  | "complexity"
  | "duplication"
  | "smells";

export interface Finding {
  readonly severity: Severity;
  readonly title: string;
  readonly description: string;
  readonly evidence: string;
  readonly file: string;
  readonly lines: { readonly start: number; readonly end: number } | null;
  readonly pass: FindingPass;
  readonly source: "static" | "ai";
}

export interface ReviewContext {
  readonly pr: PullRequest;
  readonly diff: Diff;
  readonly files: ReadonlyMap<string, string>;
  readonly tokenBudget: number;
}

export interface ReviewResult {
  readonly findings: readonly Finding[];
  readonly summary: string;
  readonly riskScore: 1 | 2 | 3 | 4 | 5 | null;
}

export type ReviewError =
  | { readonly code: "ai_unavailable"; readonly message: string }
  | { readonly code: "model_error"; readonly message: string }
  | { readonly code: "context_too_large" }
  | { readonly code: "network"; readonly cause: string };

export interface CodeAnalyzer {
  readonly id: "complexity" | "duplication" | "smells";
  analyze(context: ReviewContext): Promise<Result<readonly Finding[], ReviewError>>;
}
