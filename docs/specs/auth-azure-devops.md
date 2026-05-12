# Spec: Azure DevOps Authentication

**Phase:** 1
**Status:** Ready for implementation
**Related:** ADR-0003 (PKCE OAuth flow), ADR-0004 (keychain storage), `CONTEXT.md` (AuthSession, AuthError, Account, Organization)

---

## Goal

A user can sign in to Vigil with their Microsoft/Entra ID account, granting
Vigil access to their Azure DevOps organizations. The session persists in the
OS keychain so subsequent app launches do not require re-authentication. The
user can sign out, which removes all local credentials.

This spec covers the auth layer only — `AuthProvider`, `TokenStore`, and PKCE
helpers. Organization discovery and `PlatformProvider` integration are Phase 2.

---

## Inputs

- User initiates sign-in (in Phase 1: via a Node script; in Phase 4: via the UI).
- A live internet connection to Microsoft's Entra ID token endpoints.
- An existing `AuthSession` (for `refresh` and `signOut` operations).

---

## Outputs

- `signIn()` → `Result<AuthSession, AuthError>`
- `refresh(session)` → `Result<AuthSession, AuthError>`
- `signOut(session)` → `Result<void, AuthError>`

`AuthSession` for Azure DevOps:

```typescript
interface AuthSession {
  provider: "azure-devops";
  accessToken: string; // short-lived; do not log
  refreshToken: string; // long-lived; do not log
  expiresAt: number; // Unix timestamp (ms)
  displayName: string; // from Entra ID profile
  upn: string; // user principal name, e.g. user@company.com
}
```

`AuthSession` values are persisted to the OS keychain and **never** passed to
the renderer process.

---

## Behavior

### Sign-in flow

1. Generate a PKCE verifier (43 bytes of cryptographically random data,
   base64url-encoded per RFC 7636) and the corresponding S256 challenge.
2. Bind a local HTTP listener to a randomly-chosen free port
   (`http://localhost:{port}/callback`).
3. Construct the Entra ID authorization URL via MSAL Node's
   `PublicClientApplication`, using:
   - The Vigil multi-tenant client ID (a config constant, not a secret).
   - The `common` authority endpoint (any Microsoft/Entra account).
   - Scopes: `vso.profile vso.project vso.code vso.threads_full vso.code_status`.
   - The loopback redirect URI.
   - The PKCE challenge.
4. Open the URL in the user's default browser via Electron's `shell.openExternal`.
5. Wait up to **5 minutes** for the browser to deliver the authorization code
   to the local listener. If no callback arrives within the timeout, shut down
   the listener and return `{ ok: false, error: { code: "timeout" } }`.
6. On receiving the callback:
   - Shut down the local listener immediately.
   - Extract the `code` parameter. If an `error` parameter is present instead,
     map it:
     - `access_denied` → `{ code: "consent_denied" }`
     - anything else → `{ code: "auth_failed", message: error_description }`
7. Exchange the code for tokens via MSAL (`acquireTokenByCode`), providing the
   PKCE verifier. On MSAL error, return `{ code: "auth_failed", message }`. On
   network failure, return `{ code: "network", cause }`.
8. Fetch the user's display name and UPN from the ID token claims (or
   `vso.profile` if not present in the ID token).
9. Construct and persist the `AuthSession` to the keychain under the fixed key
   `"azure-devops"`, overwriting any existing session.
10. Return `{ ok: true, value: session }`.

If the user closes the browser before completing the flow, the listener
receives no callback and times out; this eventually returns `{ code: "timeout" }`.
There is no reliable way to distinguish "user cancelled" from "user is slow" at
the HTTP layer, so both map to `timeout`. The UI should present this neutrally
("Sign-in did not complete — try again").

### Token refresh

`refresh(session)`:

1. Call MSAL's `acquireTokenByRefreshToken` with the stored refresh token and
   the same scope list.
2. On success, construct a new `AuthSession` with updated `accessToken`,
   `refreshToken`, and `expiresAt`. Persist it to keychain, overwriting the
   old session. Return `{ ok: true, value: newSession }`.
3. On refresh token expiry (MSAL `invalid_grant`), return
   `{ ok: false, error: { code: "refresh_expired" } }`. The caller is
   responsible for triggering a new `signIn()` flow.
4. On network error, return `{ code: "network", cause }`.

`refresh()` is called by `PlatformProvider` on 401 responses (Phase 2). In
Phase 1 it only needs to work when called explicitly (e.g. in tests).

### Sign-out

`signOut(session)`:

1. Best-effort: call MSAL's token revocation endpoint with the refresh token.
   If this fails (network error, token already expired), log at debug level
   and continue.
2. Delete the keychain entry for `"azure-devops"` via `TokenStore.delete()`.
3. Return `{ ok: true, value: undefined }`.

Sign-out always succeeds locally. A failed revocation request does not block
the user from signing out.

---

## Edge cases

| Scenario                                                                 | Behavior                                                                                                                                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `signIn()` called while a valid session exists                           | Overwrites the existing session on completion.                                                                                                                |
| User already signed in on second app launch                              | Load session from keychain; skip browser. (Phase 1: checked by Node script manually. Phase 2: `PlatformProvider` uses `TokenStore.load` on startup.)          |
| Network unavailable during `signIn()`                                    | Browser fails to load the Microsoft page; user closes it; `timeout` is returned after 5 minutes. Could be improved with a faster pre-flight check (deferred). |
| Entra ID admin conditional access blocks the app                         | MSAL surfaces an error string; returned as `auth_failed`.                                                                                                     |
| Refresh token is 90+ days old (Microsoft default expiry)                 | MSAL returns `invalid_grant`; surfaced as `refresh_expired`.                                                                                                  |
| `signOut()` called with a session whose refresh token is already expired | Revocation call fails silently; keychain entry is deleted. Returns success.                                                                                   |

---

## Acceptance criteria

- [ ] `signIn()` opens the browser, completes the Authorization Code + PKCE
      flow, and returns an `AuthSession` with a non-empty `displayName` and `upn`.
- [ ] The session is persisted under keychain key `"azure-devops"`. A second
      `signIn()` call overwrites it.
- [ ] `refresh()` returns a new session with an updated `accessToken` and
      `expiresAt` when called with a valid session.
- [ ] `refresh()` returns `{ code: "refresh_expired" }` when MSAL reports
      `invalid_grant`.
- [ ] `signOut()` deletes the keychain entry and returns success even if token
      revocation fails.
- [ ] PKCE helpers produce a valid verifier/challenge pair: verifier is 43–128
      chars, base64url-encoded; challenge is the S256 hash of the verifier.
- [ ] Unit tests cover: PKCE generation, `signIn()` happy path (mocked MSAL),
      `signIn()` timeout, `refresh()` happy path, `refresh()` expiry,
      `signOut()` with revocation failure.
- [ ] Contract test: a shared test suite that any `AuthProvider` implementation
      must pass (used again in Phase 1 for `GitHubAuthProvider`).
- [ ] Phase 1 exit criterion: a Node script (`scripts/test-auth-ado.ts`) can
      call `signIn()`, complete the browser flow, print the `displayName` and
      `upn`, and on a second run skip the browser and print "restored from
      keychain."

---

## Out of scope

- Organization discovery (`/_apis/accounts`) — Phase 2.
- IPC integration (renderer-facing) — Phase 4.
- Proactive token refresh on session load — Phase 2 (`PlatformProvider`).
- Multiple simultaneous Azure DevOps accounts — deferred indefinitely.
- PAT (personal access token) fallback — separate spec (`PATAuthProvider`).

---

## Related

- `CONTEXT.md` — canonical definitions for AuthSession, AuthError, Account, Organization
- ADR-0003 — PKCE flow and app registration decisions
- ADR-0004 — keychain storage
- `ARCHITECTURE.md` §6.1 (`AuthProvider`), §6.2 (`TokenStore`), §8 (auth flow)
- `ROADMAP.md` Phase 1
