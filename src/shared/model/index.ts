export type PRRef =
  | {
      readonly platform: "github";
      readonly owner: string;
      readonly repo: string;
      readonly number: number;
    }
  | {
      readonly platform: "azure-devops";
      readonly org: string;
      readonly project: string;
      readonly repo: string;
      readonly id: number;
    };

export interface Author {
  readonly displayName: string;
  readonly login: string;
}

export interface PullRequest {
  readonly ref: PRRef;
  readonly title: string;
  readonly body: string;
  readonly author: Author;
  readonly state: "open" | "draft";
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly url: string;
  readonly targetBranch: string;
  readonly sourceBranch: string;
  readonly headSha: string;
}

export interface DiffLine {
  readonly kind: "context" | "added" | "removed";
  readonly content: string;
  readonly oldLine: number | null;
  readonly newLine: number | null;
}

export interface Hunk {
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  readonly lines: readonly DiffLine[];
}

export interface FileDiff {
  readonly status: "added" | "modified" | "deleted" | "renamed";
  readonly oldPath: string | null;
  readonly newPath: string;
  readonly hunks: readonly Hunk[];
}

export interface Diff {
  readonly files: readonly FileDiff[];
}

export interface Comment {
  readonly id: string;
  readonly body: string;
  readonly author: Author;
  readonly createdAt: Date;
}

export interface Thread {
  readonly id: string;
  readonly file: string;
  readonly line: number;
  readonly comments: readonly Comment[];
  readonly resolved: boolean;
}

export type NewComment =
  | { readonly kind: "inline"; readonly body: string; readonly path: string; readonly line: number }
  | { readonly kind: "pr_comment"; readonly body: string };

export type ReviewVerdict = "approved" | "changes_requested" | "commented";

export interface NewReview {
  readonly verdict: ReviewVerdict;
  readonly body: string;
  readonly comments: readonly NewComment[];
}

export type PlatformError =
  | { readonly code: "not_found" }
  | { readonly code: "forbidden" }
  | { readonly code: "rate_limited"; readonly retryAfterMs?: number }
  | { readonly code: "network"; readonly cause?: string }
  | { readonly code: "platform_error"; readonly message: string };
