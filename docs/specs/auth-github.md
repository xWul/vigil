# Spec: GitHub Authentication

**Phase:** 1
**Status:** Ready for implementation
**Related:** ADR-0004 (keychain storage), `CONTEXT.md` (AuthSession, AuthError, Account), `docs/specs/auth-azure-devops.md`

---

## Goal

A user can sign in to Vigil with their GitHub account, granting Vigil
access to their repositories and organizations. The session persists in
the OS keychain so subsequent app launches do not require
re-authentication. The user can sign out, which removes all local
credentials.

This spec covers the auth layer only — `AuthProvider` and `TokenStore`.
Repository and PR access via `PlatformProvider` is Phase 2.

---

## Inputs

- User initiates sign-in (in Phase 1: via a Node script; in Phase 4: via the UI).
- A live internet connection to GitHub's OAuth endpoints.
- An existing `AuthSession` (for `refresh` and `signOut` operations).

---

## Outputs

- `signIn()` → `Result<AuthSession, AuthError>`
- `refresh(session)` → `Result<AuthSession, AuthError>`
- `signOut(session)` → `Result<void, AuthError>`

`AuthSession` for GitHub:

```typescript
interface GitHubSession {
  provider: "github";
  accessToken: string; // do not log
  displayName: string; // GitHub name, falls back to login if unset
  login: string; // GitHub username, e.g. "ada"
}
```

No `refreshToken` or `expiresAt` — GitHub OAuth App tokens do not expire
and GitHub does not issue refresh tokens for this flow.

`AuthSession` values are persisted to the OS keychain and **never** passed
to the renderer process.

---

## App registration

Vigil ships with a single Vigil-owned GitHub OAuth App. The `client_id`
is a public constant — not a secret, safe to ship in source. No
`client_secret` is stored anywhere. The OAuth App must have Device Flow
enabled in its GitHub settings.

This follows the same model as the Azure DevOps registration (ADR-0003)
applied to GitHub. No new ADR is needed.

Scopes requested at sign-in: **`repo read:org`**.

| Scope      | Purpose                                                                    |
| ---------- | -------------------------------------------------------------------------- |
| `repo`     | Read diffs, file contents, PRs; post comments and reviews on private repos |
| `read:org` | List organization membership (Phase 2)                                     |

All scopes are requested upfront at sign-in. One permission prompt; no
mid-task incremental consent.

---

## Behavior

### Sign-in flow (Device Flow)

1. POST to `https://github.com/login/device/code` with `client_id` and
   `scope`. On network failure, return `{ code: "network", cause }`.
2. GitHub returns `device_code`, `user_code`, `verification_uri`,
   `expires_in` (seconds), and `interval` (minimum polling delay,
   seconds).
3. Call the injected `presentDeviceCode(userCode, verificationUri)`
   callback and wait for it to resolve. The caller is responsible for
   displaying the code to the user (console in Phase 1; UI in Phase 4).
4. Begin polling `https://github.com/login/oauth/access_token` with
   `client_id`, `device_code`, and
   `grant_type=urn:ietf:params:oauth:grant-type:device_code`. Parse the
   response as `application/x-www-form-urlencoded`.
5. On each poll response:
   - `access_token` present → proceed to step 6.
   - `error: authorization_pending` → wait `interval` seconds, poll again.
   - `error: slow_down` → add 5 seconds to `interval`, wait, poll again.
   - `error: expired_token` → return `{ code: "timeout" }`.
   - `error: access_denied` → return `{ code: "consent_denied" }`.
   - Any other `error` → return `{ code: "auth_failed", message: error_description }`.
   - Network failure → return `{ code: "network", cause }`.
6. With the access token, call `GET https://api.github.com/user`
   (Authorization: `Bearer <token>`). On network failure, return
   `{ code: "network", cause }`.
7. Construct the `GitHubSession`:
   - `accessToken` from the token response.
   - `login` from `GET /user` → `login` field.
   - `displayName` from `GET /user` → `name` field; fall back to `login`
     if `name` is `null`.
8. Persist the session to the keychain under the fixed key `"github"`,
   overwriting any existing session.
9. Return `{ ok: true, value: session }`.

### Token refresh

`refresh(session)`:

GitHub OAuth App tokens do not expire. `refresh()` is a no-op:

1. If `session.provider !== "github"`, return
   `{ code: "auth_failed", message: "session provider mismatch" }`.
2. Otherwise return `{ ok: true, value: session }` immediately.

If a token has been revoked by the user on GitHub, the `PlatformProvider`
will surface a 401. At that point the caller is responsible for invoking
`signIn()` again.

### Sign-out

`signOut(session)`:

1. If `session.provider !== "github"`, return
   `{ code: "auth_failed", message: "session provider mismatch" }`.
2. Delete the keychain entry for `"github"` via `TokenStore.delete()`.
3. Return `{ ok: true, value: undefined }`.

**Note:** GitHub OAuth App token revocation requires a `client_secret`,
which Vigil does not store. Sign-out is therefore local-only. The token
remains valid on GitHub's side until the user revokes it manually at
`https://github.com/settings/applications`. This is acceptable for a
public OAuth App with no client secret.

---

## Edge cases

| Scenario                                                  | Behavior                                                                                 |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `signIn()` called while a valid session exists            | Overwrites on completion.                                                                |
| User never visits the verification URL                    | Device code expires; `expired_token` is returned during polling → `{ code: "timeout" }`. |
| User denies the permission prompt on GitHub               | `access_denied` during polling → `{ code: "consent_denied" }`.                           |
| GitHub rate-limits the polling client                     | `slow_down` → interval increases by 5 s; polling continues.                              |
| `GET /user` returns `name: null`                          | `displayName` falls back to `login`.                                                     |
| Network drops after token exchange but before `GET /user` | Return `{ code: "network" }` — no partial session is persisted.                          |
| Token revoked by user on GitHub between sessions          | `refresh()` returns the session unchanged; 401 surfaces in Phase 2.                      |

---

## Acceptance criteria

- [ ] `signIn()` calls `presentDeviceCode` with the user code and
      verification URI before polling begins.
- [ ] `signIn()` returns a `GitHubSession` with non-empty `login` and
      `displayName` on success.
- [ ] The session is persisted under keychain key `"github"`. A second
      `signIn()` call overwrites it.
- [ ] `signIn()` returns `{ code: "timeout" }` when the device code expires.
- [ ] `signIn()` returns `{ code: "consent_denied" }` on `access_denied`.
- [ ] Polling respects `interval` and adds 5 s on `slow_down`.
- [ ] `refresh()` returns the existing session unchanged without any
      network call.
- [ ] `signOut()` deletes the keychain entry and returns success.
- [ ] `displayName` falls back to `login` when GitHub `name` is `null`.
- [ ] Unit tests cover: happy path (mocked HTTP), timeout, consent denied,
      slow_down handling, `GET /user` failure, `displayName` fallback,
      `refresh()` no-op, `signOut()`.
- [ ] Contract tests (`authProviderContract.ts`) pass.
- [ ] Phase 1 exit criterion: `scripts/test-auth-github.ts` can call
      `signIn()`, complete the Device Flow, print `login` and `displayName`,
      and on a second run skip the flow and print "restored from keychain".

---

## Out of scope

- GitHub App installation tokens (short-lived, scoped per installation) — separate provider if needed.
- Fine-grained personal access tokens — covered by `PATAuthProvider`.
- Organization-level repo listing — Phase 2 (`PlatformProvider`).
- IPC integration (renderer-facing) — Phase 4.
- Multiple simultaneous GitHub accounts — deferred indefinitely.

---

## Related

- `CONTEXT.md` — canonical definitions for AuthSession, AuthError, Account
- ADR-0004 — keychain storage
- `docs/specs/auth-azure-devops.md` — parallel spec for comparison
- `ARCHITECTURE.md` §6.1 (`AuthProvider`), §6.2 (`TokenStore`)
- `ROADMAP.md` Phase 1
