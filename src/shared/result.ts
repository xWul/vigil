/**
 * A typed alternative to throwing for expected failure modes.
 *
 * Conventions:
 * - Use Result<T, E> for async functions whose failures are part of the
 *   domain (network errors, auth expired, invalid input).
 * - Continue to throw for truly unexpected failures and programmer errors.
 * - See CLAUDE.md § "Error handling" and ARCHITECTURE.md § 6.5.
 */
export type Result<T, E> = Ok<T> | Err<E>;

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}
