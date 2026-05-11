# Domain Glossary — Vigil

Terms that are meaningful at the domain level and need precise definitions
to prevent sloppy language producing sloppy code. Implementation details
do not belong here.

---

## AuthSession

The result of a successful sign-in. Contains everything needed to make
authenticated API calls on the user's behalf and to refresh those
credentials when they expire.

For Azure DevOps:
- access token (short-lived)
- refresh token (long-lived)
- expiry timestamp
- user display name (from Entra ID)
- user principal name / UPN (e.g. `user@company.com`)

An `AuthSession` is **identity-scoped, not org-scoped**. One Microsoft
account can belong to many Azure DevOps organizations; org membership is
discovered separately (Phase 2). An `AuthSession` answers "who are you?"
not "which org are you in?"

`AuthSession` values are persisted to the OS keychain via `TokenStore`
and never exposed to the renderer process.

---

## Account

The user's identity on a given platform. For Azure DevOps, this is the
user's Microsoft/Entra ID identity (identified by UPN). For GitHub, it
is the GitHub account (identified by login/username).

An Account is distinct from an Organization. An Account can be a member
of many Organizations.

---

## Organization (Azure DevOps)

The top-level grouping in Azure DevOps, accessed at
`https://dev.azure.com/{org}`. A single Microsoft Account can be a
member of multiple Organizations. Organization membership discovery
is out of scope for Phase 1 (auth); it is handled by the
`AzureDevOpsProvider` in Phase 2.

---

## AuthError

The typed failure union returned by `AuthProvider` operations. Six variants:

- `cancelled` — user closed the browser without completing the flow (not a user-facing error; dismiss silently)
- `timeout` — local loopback listener waited too long for the OAuth callback
- `network` — could not reach Microsoft's token endpoint (transient)
- `consent_denied` — user declined the permission prompt
- `refresh_expired` — the long-lived refresh token is no longer valid; user must sign in again
- `auth_failed` — catch-all for MSAL errors, carries a `message` string

---
