import type { Result } from "./result.js";
import type { AuthError, ConnectedAccount } from "./auth.js";
import type { AnalyzerConfig } from "./analyzer-config.js";
import type { Settings, SettingsError, WritableSettings } from "./settings.js";
import type { FindingPass, ReviewError, ReviewResult, Finding } from "./review.js";
import type {
  Comment,
  Diff,
  NewComment,
  NewReview,
  PlatformError,
  PRRef,
  PullRequest,
} from "./model/index.js";

// ── Invoke channels (renderer → main, each returns Promise<Result<T, E>>) ───

export interface IpcContract {
  // Auth
  "auth:signIn": (platform: "github" | "azure-devops") => Result<ConnectedAccount, AuthError>;
  "auth:signInWithPAT": (
    platform: "github" | "azure-devops",
    token: string,
  ) => Result<ConnectedAccount, AuthError>;
  "auth:signOut": (platform: "github" | "azure-devops") => Result<void, AuthError>;
  "auth:getAccounts": () => Result<readonly ConnectedAccount[], never>;

  // Platform
  "platform:listPRs": () => Result<readonly PullRequest[], PlatformError>;
  "platform:getPRWithDiff": (ref: PRRef) => Result<{ pr: PullRequest; diff: Diff }, PlatformError>;
  "platform:submitReview": (ref: PRRef, review: NewReview) => Result<void, PlatformError>;
  "platform:postComment": (ref: PRRef, comment: NewComment) => Result<Comment, PlatformError>;

  // Review
  "review:run": (ref: PRRef) => Result<ReviewResult, ReviewError>;
  "review:getCached": (ref: PRRef, headSha: string) => Result<ReviewResult | null, never>;
  "review:invalidate": (ref: PRRef, headSha: string) => Result<void, never>;
  "review:challenge": (
    ref: PRRef,
    finding: Finding,
    hunkContext: string,
    messages: readonly { role: "user" | "assistant"; content: string }[],
  ) => Result<void, ReviewError>;

  // Settings
  "settings:get": () => Result<Settings, never>;
  "settings:set": (update: Partial<WritableSettings>) => Result<void, SettingsError>;
  "settings:setApiKey": (
    provider: "anthropic" | "openai",
    key: string,
  ) => Result<void, SettingsError>;
  "settings:deleteApiKey": (provider: "anthropic" | "openai") => Result<void, SettingsError>;
  "settings:getAnalyzerConfig": (ref: PRRef) => Result<AnalyzerConfig, SettingsError>;
  "settings:setAnalyzerConfig": (ref: PRRef, config: AnalyzerConfig) => Result<void, SettingsError>;

  // Findings
  "findings:getSuppressed": (
    ref: PRRef,
    headSha: string,
  ) => Result<readonly string[], SettingsError>;
  "findings:setSuppressed": (
    ref: PRRef,
    headSha: string,
    keys: readonly string[],
  ) => Result<void, SettingsError>;

  // App
  "app:copyDiagnostics": () => Result<void, never>;
  "app:getVersion": () => Result<string, never>;
  "app:checkForUpdate": () => Result<void, never>;
  "app:installUpdate": () => Result<void, never>;
}

// ── Update status ────────────────────────────────────────────────────────────

export type UpdateStatus =
  | { readonly status: "checking" }
  | { readonly status: "available"; readonly version: string }
  | { readonly status: "downloading"; readonly progress: number }
  | { readonly status: "ready"; readonly version: string }
  | { readonly status: "up-to-date" }
  | { readonly status: "error"; readonly message: string };

// ── Push events (main → renderer, one-way) ───────────────────────────────────

export interface IpcEvents {
  "review:finding": { readonly reviewId: string; readonly finding: Finding };
  "review:pass": {
    readonly reviewId: string;
    readonly pass: FindingPass;
    readonly status: "start" | "complete";
    readonly count: number;
  };
  "review:challengeChunk": { readonly token: string; readonly done: boolean };
  "git:cacheStatus": {
    readonly repoKey: string;
    readonly status: "cloning" | "fetching" | "ready" | "error";
    readonly error?: string;
  };
  "app:updateStatus": UpdateStatus;
}
