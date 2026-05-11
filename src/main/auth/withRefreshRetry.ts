import type { Result } from "../../shared/result.js";
import type { AuthError, AuthProvider, AuthSession } from "./AuthProvider.js";
import type { TokenStore } from "./TokenStore.js";

/**
 * Executes `call` with the current session. If the result is an
 * "unauthorized" error (as determined by the caller-supplied predicate),
 * refreshes the session once, persists the new session, and retries.
 *
 * A second unauthorized after a successful refresh is returned as-is —
 * no further attempts are made.
 */
export async function withRefreshRetry<T, E>(
  session: AuthSession,
  provider: AuthProvider,
  tokenStore: TokenStore,
  tokenKey: string,
  call: (session: AuthSession) => Promise<Result<T, E>>,
  isUnauthorized: (error: E) => boolean,
): Promise<Result<T, E | AuthError>> {
  const first = await call(session);

  if (first.ok || !isUnauthorized(first.error)) {
    return first;
  }

  const refreshResult = await provider.refresh(session);
  if (!refreshResult.ok) {
    return refreshResult;
  }

  await tokenStore.save(tokenKey, refreshResult.value);

  return call(refreshResult.value);
}
