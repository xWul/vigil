import type { Diff, PullRequest } from "../platforms/model/index.js";
import type {
  Finding,
  FindingPass,
  ReviewError,
  ReviewResult,
  Severity,
} from "../../shared/review.js";
import type { Result } from "../../shared/result.js";

export type { Finding, FindingPass, ReviewError, ReviewResult, Severity };

export interface ReviewContext {
  readonly pr: PullRequest;
  readonly diff: Diff;
  readonly files: ReadonlyMap<string, string>;
  readonly tokenBudget: number;
}

export interface CodeAnalyzer {
  readonly id:
    | "complexity"
    | "duplication"
    | "smells"
    | "debug-artifacts"
    | "type-safety"
    | "change-classification"
    | "regression";
  analyze(context: ReviewContext): Promise<Result<readonly Finding[], ReviewError>>;
}
