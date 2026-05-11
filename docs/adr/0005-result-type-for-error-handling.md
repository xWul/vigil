# ADR-0005: Result Type for Expected Failure Modes

## Status

Accepted — 2026-05-11

## Context

Vigil's main process makes many async calls that can fail in expected,
domain-meaningful ways: network requests to GitHub and Azure DevOps APIs,
token refreshes that may find an expired refresh token, keychain reads that
may return nothing. These are not programmer errors — they are predictable
failure modes that callers need to handle explicitly.

TypeScript's default approach is to throw exceptions. The problem: thrown
exceptions are invisible in the type system. A function signature
`fetchPR(): Promise<PullRequest>` gives callers no information about what
can go wrong. Callers forget to handle failures, or handle only the failures
they thought of.

Options considered:

- **Throw exceptions** (TypeScript default) — failure modes invisible at the
  type level; callers can't tell what to expect.
- **Return `Result<T, E>`** (discriminated union) — failure modes are part of
  the function signature; the compiler enforces handling.
- **Return `T | null`** — distinguishes success from failure but loses the
  error type entirely; no way to tell the caller *why* it failed.
- **Use a library** (`neverthrow`, `fp-ts`, `true-myth`) — rich Result
  combinators, but adds a dependency and a learning curve for a type that is
  straightforward to write in 30 lines.

## Decision

Use a hand-rolled `Result<T, E>` type in `src/shared/result.ts`:

```typescript
type Result<T, E> = Ok<T> | Err<E>;
```

with `ok()`, `err()`, `isOk()`, and `isErr()` helpers.

Throwing is still used for programmer errors (invalid arguments, broken
invariants) and truly unexpected failures. `Result` is for expected failure
modes that are part of the domain.

## Consequences

### Positive

- **Failure modes are part of the signature.** Callers see exactly what can
  go wrong. The compiler forces exhaustive handling of the discriminated union.
- **No dependency.** The type is 30 lines of straightforward TypeScript. No
  library to update, audit, or explain to contributors.
- **Shared across both processes.** `src/shared/result.ts` is compiled into
  both the main and renderer bundles. The renderer can use the same type when
  interpreting IPC responses.
- **Conventional.** This pattern is widely used in TypeScript codebases
  influenced by Rust and functional languages. Contributors familiar with
  either will recognise it immediately.

### Negative

- **No combinator library.** Chaining Result-returning operations requires
  explicit `if (!result.ok)` checks rather than `.andThen()` / `.map()`
  chains. Acceptable given the code volume in this project; revisit if the
  verbosity becomes painful.
- **Discipline required.** The compiler does not prevent a developer from
  throwing where they should return `Result`. Code review is the enforcement
  mechanism. The CLAUDE.md convention states the rule explicitly.

### Where the line is drawn

| Situation | Approach |
|---|---|
| Network error fetching a PR | `Result` — expected, typed |
| OAuth token expired | `Result` — expected, typed |
| Keychain entry not found | `Result` — expected, typed |
| Null pointer dereference | throw — programmer error |
| Unrecognised IPC channel | throw — programmer error |
| JSON.parse on trusted internal data | throw — should never fail |

## Alternatives Considered

### Throw exceptions (default)

Simple, familiar, no boilerplate.

Not chosen. The core loops in Vigil (auth, PR fetch, AI review) have many
failure modes that the UI needs to handle distinctly (show "token expired"
differently from "rate limited" differently from "network unavailable").
Expressing this through exception subclasses and catch blocks is more verbose
and less type-safe than a discriminated union.

### `neverthrow`

A well-designed Result library with `.map`, `.andThen`, `.mapErr` combinators
and good TypeScript types. Would reduce boilerplate for chained operations.

Not chosen for v1. The hand-rolled type covers current needs without adding
a dependency. If combinators become noticeably useful as the codebase grows,
migrating to `neverthrow` is a straightforward mechanical change — the
`Result<T, E>` shape is compatible.

### `T | null`

Returns `null` on failure. No error type, no failure reason.

Not chosen. Losing the error type means the UI can only display a generic
error message. The Azure DevOps auth flow alone has six distinct error codes
that map to different UI states (`timeout`, `consent_denied`, `refresh_expired`,
etc.).

## References

- `src/shared/result.ts` — implementation
- `ARCHITECTURE.md` §6.5 (`Result<T, E>`)
- `CLAUDE.md` § "Error handling"
- ADR-0003: error types used in auth flows
