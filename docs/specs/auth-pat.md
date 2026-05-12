# Spec: PAT Authentication

**Phase:** 1
**Status:** Ready for implementation
**Related:** ADR-0004 (keychain storage), `docs/specs/auth-github.md`, `docs/specs/auth-azure-devops.md`

---

## Goal

A user can authenticate to Vigil with a Personal Access Token (PAT) by
pasting it manually. This is the fallback path for environments where
the OAuth flows are impractical (CI, scripted use, corporate proxies).

This spec covers the auth layer only — `AuthProvider` and `TokenStore`.

---

## Inputs

- User provides a PAT string (via an injected callback).
- A target platform: `"github"` or `"azure-devops"`.
- An existing `PATSession` (for `refresh` and `signOut` operations).

---

## Outputs

- `signIn()` → `Result<PATSession, AuthError>`
- `refresh(session)` → `Result<PATSession, AuthError>`
- `signOut(session)` → `Result<void, AuthError>`

`PATSession` (already in `AuthProvider.ts`):

```typescript
interface PATSession {
  provider: "pat";
  platform: "azure-devops" | "github";
  accessToken: string; // the PAT itself — do not log
}
```

No `displayName`, `login`, or expiry information — acquiring these would
require a network call, which `PATAuthProvider` deliberately avoids.

---

## Design decisions

### One provider instance per platform

`PATAuthProvider` takes `platform` as a constructor argument. Callers
create separate instances for GitHub and Azure DevOps. This keeps the
`signIn()` signature consistent with `AuthProvider` (no parameters) and
avoids conditional logic inside the provider.

### No network validation on sign-in

`signIn()` does not verify the token against the platform API. The user
is trusted to supply a valid token; errors surface in Phase 2 when the
`PlatformProvider` makes its first API call. Adding a validation call
would introduce network dependencies and an extra failure mode without
meaningful benefit at this layer.

### PATs are treated as non-expiring

`refresh()` is a no-op (returns the session unchanged). GitHub PATs can
be set to expire, and Azure DevOps PATs always have an expiry, but the
`PATAuthProvider` has no way to refresh a PAT without user action. A
401 from the platform API in Phase 2 is the signal to call `signIn()`
again. This mirrors the GitHub OAuth App token model.

### Keychain key

Sessions are stored under `"pat-github"` or `"pat-azure-devops"`.
These keys are distinct from the OAuth provider keys (`"github"`,
`"azure-devops"`) so both can coexist in the token store simultaneously.

### Cancelled and empty-token errors

If the `askForPAT` callback rejects (e.g. user aborts the prompt), the
provider returns `{ code: "cancelled" }`. If the callback resolves with
an empty or whitespace-only string, the provider returns
`{ code: "auth_failed", message: "empty token" }` rather than storing a
useless credential.

---

## Behavior

### Sign-in

1. Call the injected `askForPAT()` callback. If it rejects, return
   `{ code: "cancelled" }`.
2. Trim the returned string. If empty, return
   `{ code: "auth_failed", message: "empty token" }`.
3. Construct `PATSession { provider: "pat", platform, accessToken }`.
4. Persist to the token store under `"pat-${platform}"`.
5. Return `{ ok: true, value: session }`.

### Token refresh

1. If `session.provider !== "pat"` or `session.platform !== this.platform`,
   return `{ code: "auth_failed", message: "session provider mismatch" }`.
2. Return `{ ok: true, value: session }` immediately (no-op).

### Sign-out

1. If `session.provider !== "pat"` or `session.platform !== this.platform`,
   return `{ code: "auth_failed", message: "session provider mismatch" }`.
2. Delete the token store entry for `"pat-${platform}"`.
3. Return `{ ok: true, value: undefined }`.

---

## Acceptance criteria

- [ ] `signIn()` persists the PAT under `"pat-${platform}"` and returns a
      `PATSession`.
- [ ] `signIn()` returns `{ code: "cancelled" }` if `askForPAT` rejects.
- [ ] `signIn()` returns `{ code: "auth_failed" }` for an empty token.
- [ ] `refresh()` returns the session unchanged with no network call.
- [ ] `signOut()` removes the token store entry and returns success.
- [ ] Wrong-provider and wrong-platform calls to `refresh()` and `signOut()`
      return `{ code: "auth_failed" }`.
- [ ] Unit tests cover all of the above.
- [ ] Contract tests (`authProviderContract.ts`) pass.

---

## Out of scope

- Token validation against the platform API — Phase 2.
- Token expiry tracking — PATs are treated as non-expiring at this layer.
- Multiple PATs for the same platform — one stored token per platform.
- UI entry point — Phase 4.
