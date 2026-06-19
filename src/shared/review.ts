export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type FindingPass =
  | "correctness"
  | "security"
  | "consistency"
  | "complexity"
  | "duplication"
  | "smells"
  | "debug-artifacts"
  | "type-safety"
  | "change-classification"
  | "regression"
  | "architecture";

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
