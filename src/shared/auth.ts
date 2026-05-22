export type AuthError =
  | { readonly code: "cancelled" }
  | { readonly code: "timeout" }
  | { readonly code: "network"; readonly cause?: string }
  | { readonly code: "consent_denied" }
  | { readonly code: "refresh_expired" }
  | { readonly code: "auth_failed"; readonly message: string };

export interface ConnectedAccount {
  readonly platform: "github" | "azure-devops";
  readonly displayName: string;
  readonly login: string;
}
