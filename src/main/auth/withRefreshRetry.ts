import type { Result } from "../../shared/result.js";
import { NoopLogger } from "../../shared/logger.js";
import type { Logger } from "../../shared/logger.js";
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
  logger: Logger = new NoopLogger(),
): Promise<Result<T, E | AuthError>> {
  const first = await call(session);

  if (first.ok || !isUnauthorized(first.error)) {
    return first;
  }

  logger.debug("auth.refreshRetry.attempt", { provider: session.provider });

  const refreshResult = await provider.refresh(session);
  if (!refreshResult.ok) {
    logger.warn("auth.refreshRetry.failed", {
      provider: session.provider,
      code: refreshResult.error.code,
    });
    return refreshResult;
  }

  await tokenStore.save(tokenKey, refreshResult.value);
  logger.info("auth.refreshRetry.success", { provider: session.provider });

  const second = await call(refreshResult.value);
  if (!second.ok && isUnauthorized(second.error)) {
    logger.warn("auth.refreshRetry.secondUnauth", { provider: session.provider });
  }
  return second;
}
