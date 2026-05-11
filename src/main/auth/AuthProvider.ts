import type { Result } from "../../shared/result.js";

// ---------------------------------------------------------------------------
// AuthSession
// ---------------------------------------------------------------------------

export interface AzureDevOpsSession {
  readonly provider: "azure-devops";
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number; // Unix timestamp (ms)
  readonly displayName: string;
  readonly upn: string; // user principal name, e.g. user@company.com
}

export interface GitHubSession {
  readonly provider: "github";
  readonly accessToken: string;
  readonly displayName: string;
  readonly login: string; // GitHub username
}

export interface PATSession {
  readonly provider: "pat";
  readonly platform: "azure-devops" | "github";
  readonly accessToken: string; // the PAT itself
}

/** Discriminated union of all provider session shapes. */
export type AuthSession = AzureDevOpsSession | GitHubSession | PATSession;

// ---------------------------------------------------------------------------
// AuthError
// ---------------------------------------------------------------------------

/** Typed failure modes returned by AuthProvider operations. See CONTEXT.md. */
export type AuthError =
  | { readonly code: "cancelled" }
  | { readonly code: "timeout" }
  | { readonly code: "network"; readonly cause?: string }
  | { readonly code: "consent_denied" }
  | { readonly code: "refresh_expired" }
  | { readonly code: "auth_failed"; readonly message: string };

// ---------------------------------------------------------------------------
// AuthProvider
// ---------------------------------------------------------------------------

export interface AuthProvider {
  readonly id: "azure-devops" | "github" | "pat";
  signIn(): Promise<Result<AuthSession, AuthError>>;
  refresh(session: AuthSession): Promise<Result<AuthSession, AuthError>>;
  signOut(session: AuthSession): Promise<Result<void, AuthError>>;
}
