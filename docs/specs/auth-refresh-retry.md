# Spec: Token Refresh Retry

**Phase:** 1
**Status:** Ready for implementation
**Related:** `AuthProvider`, `TokenStore`, `docs/specs/auth-azure-devops.md`

---

## Goal

Provide a shared utility that any `PlatformProvider` (Phase 2) can use
to transparently refresh an expired token and retry a failed call exactly
once, without each provider implementing its own retry logic.

---

## Function signature

```typescript
withRefreshRetry<T, E>(
  session: AuthSession,
  provider: AuthProvider,
  tokenStore: TokenStore,
  tokenKey: string,
  call: (session: AuthSession) => Promise<Result<T, E>>,
  isUnauthorized: (error: E) => boolean,
): Promise<Result<T, E | AuthError>>
```

- `tokenKey` — the key used to persist the session (e.g. `"azure-devops"`).
- `call` — the operation to execute; receives the current session.
- `isUnauthorized` — caller-supplied predicate: returns `true` when the
  error means the token is no longer valid and a refresh should be attempted.
  This keeps the utility decoupled from any specific error type.

---

## Behavior

1. Execute `call(session)`.
2. If the result is `ok` or `!isUnauthorized(error)`, return it immediately.
3. Call `provider.refresh(session)`.
4. If refresh fails, return the `AuthError` from the failed refresh.
5. Persist the refreshed session to `tokenStore` under `tokenKey`.
6. Retry `call(newSession)` once and return whatever it returns —
   including a second 401 if the token is already revoked.

**Single retry only.** A second 401 after a successful refresh means the
token is revoked or the platform has a different problem; further retries
would loop indefinitely. Return the retry result as-is.

---

## Acceptance criteria

- [ ] First call succeeds → returned immediately, no refresh.
- [ ] First call returns a non-unauthorized error → returned immediately,
      no refresh.
- [ ] First call returns unauthorized → refresh succeeds → refreshed
      session is persisted → retry succeeds → retry result returned.
- [ ] First call returns unauthorized → refresh fails → `AuthError`
      from the refresh returned; retry not attempted.
- [ ] First call returns unauthorized → refresh succeeds → retry also
      returns unauthorized → retry result returned as-is (no second
      refresh).
- [ ] `isUnauthorized` predicate gates all refresh attempts.
- [ ] Unit tests cover all of the above.

---

## Out of scope

- Retry on network errors — transient failures are the caller's problem.
- Exponential back-off — not needed for a single retry.
- Concurrent call de-duplication — callers serialize refresh themselves.
