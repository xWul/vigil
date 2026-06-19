# Plan 002: Make log redaction recursive and value-aware

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1278cf3..HEAD -- src/shared/logger.ts src/shared/logger.test.ts src/main/ipc/index.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (but plan 003 depends on this one)
- **Category**: security
- **Planned at**: commit `1278cf3`, 2026-06-12

## Why this matters

The project's documented security model (ARCHITECTURE.md §12) promises:
"tokens, secrets, and keys are stripped before any log entry is written, even
at debug level." The current `redact()` does not deliver that: it only checks
**top-level keys** of the meta object, so a secret nested one level deep
(`{ user: { accessToken: "…" } }`) or a secret embedded **inside a string
value** (e.g. a git error message containing
`https://x-access-token:<token>@github.com/...`) is written to
`vigil.log` verbatim. The string-value case is not hypothetical — plan 003
documents a live path where a failed git clone logs exactly such a URL. The
"Copy diagnostics" feature then puts that log on the user's clipboard,
destined for a public GitHub issue. This plan is the safety net under plan 003
and must land first.

## Current state

- `src/shared/logger.ts` — the `Logger` interface, `redact()`, `NoopLogger`,
  `ConsoleLogger`. `redact()` at lines 14–21:

```typescript
// src/shared/logger.ts:14-21
export function redact(meta: Record<string, unknown>): Record<string, unknown> {
  const SENSITIVE = /token|secret|key|password|pat/i;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    result[k] = SENSITIVE.test(k) ? "[redacted]" : v;
  }
  return result;
}
```

- `src/main/logger.ts` — `FileLogger` (Electron main transport). Check how it
  applies redaction; it should call the same shared `redact()` (ConsoleLogger
  does, at `src/shared/logger.ts:69`). Whatever it does today, after this plan
  both transports must use the new deep redaction.
- `src/shared/logger.test.ts` — existing tests cover flat objects only.
- `src/main/ipc/index.ts:496-513` — `app:copyDiagnostics` handler has its own
  belt-and-suspenders regex which only matches JSON-style quoted fields:

```typescript
// src/main/ipc/index.ts:508-509
const SENSITIVE = /("(?:token|secret|key|password|pat|authorization)":\s*)"[^"]*"/gi;
const content = parts.join("").replace(SENSITIVE, '$1"[redacted]"');
```

This misses URL-embedded credentials (`https://user:secret@host/...`).

- Convention notes: TypeScript strict, **no `any`** — use `unknown` and type
  guards when walking arbitrary values. Pure function, co-located test
  (`logger.ts` / `logger.test.ts` in the same directory). Conventional commits.

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Typecheck | `pnpm typecheck`                 | exit 0              |
| This test | `pnpm test src/shared/logger`    | all pass            |
| Full gate | `pnpm check`                     | exit 0              |

## Scope

**In scope**:
- `src/shared/logger.ts`
- `src/shared/logger.test.ts`
- `src/main/logger.ts` (only to ensure FileLogger uses the shared deep redaction)
- `src/main/ipc/index.ts` (only the `app:copyDiagnostics` regex block, lines ~506-510)
- `CHANGELOG.md`

**Out of scope**:
- `src/main/git/RepoCache.ts` — the source of the leaking message is plan 003.
- Changing the `Logger` interface itself (it is one of the stable abstractions;
  an interface change needs an ADR per CLAUDE.md).
- Log levels, rotation, or transport behavior.

## Git workflow

- **Never commit to `main`.** Branch: `fix/deep-log-redaction`
- Conventional commit, e.g. `fix: redact nested objects and credential-bearing strings in logs`
- CHANGELOG entry in the same commit (project rule).

## Steps

### Step 1: Write failing tests first

In `src/shared/logger.test.ts` add tests (model after the existing flat-object
tests in the same file):

1. Nested object: `redact({ session: { accessToken: "abc" } })` →
   `{ session: { accessToken: "[redacted]" } }`.
2. Array of objects: `redact({ items: [{ apiKey: "k" }] })` → key redacted.
3. URL credential in a string value:
   `redact({ message: "fatal: unable to access 'https://x-access-token:abc@github.com/a/b.git'" })`
   → the `x-access-token:abc@` portion replaced so that `abc` does not appear
   in the output (expect something like `https://[redacted]@github.com/a/b.git`).
4. Bearer header in a string value: `redact({ message: "Authorization: Bearer abc.def" })`
   → token portion replaced.
5. Non-sensitive values pass through unchanged (string, number, null, boolean).
6. Cycle safety: an object with a circular reference does not throw
   (truncate or replace the cycle with `"[circular]"`).

**Verify**: `pnpm test src/shared/logger` → new tests FAIL (red), existing pass.

### Step 2: Implement deep redaction

Rewrite `redact()` in `src/shared/logger.ts`:

- Keep the existing key-pattern `/token|secret|key|password|pat/i` behavior.
- Recurse into plain objects and arrays (use a `WeakSet` for cycle detection;
  cap depth at e.g. 8 and emit `"[truncated]"` beyond it).
- For every **string value** (at any depth), apply a `scrubString()` that
  replaces:
  - URL userinfo credentials: `/(https?:\/\/)[^@/\s]+@/gi` → `$1[redacted]@`
  - Bearer tokens: `/(bearer\s+)[A-Za-z0-9._~+/-]+=*/gi` → `$1[redacted]`
- Export `scrubString` so `app:copyDiagnostics` (step 3) and plan 003 can
  reuse it.
- Types: signature stays `(meta: Record<string, unknown>) => Record<string, unknown>`.
  Inner walker takes `unknown`. No `any`, no `as` casts except a justified one
  at the `Record` boundary if needed.

**Verify**: `pnpm test src/shared/logger` → all pass (green).

### Step 3: Strengthen the diagnostics scrubber

In `src/main/ipc/index.ts` (`app:copyDiagnostics`), after the existing JSON-field
regex replacement, also run the content through the exported `scrubString` so
URL-embedded and Bearer credentials are caught in the clipboard path too.

**Verify**: `pnpm typecheck` → exit 0.

### Step 4: Confirm FileLogger uses it

Open `src/main/logger.ts`. If it formats meta itself, make sure it calls the
shared `redact()` (it likely already does — confirm, and add a test only if it
doesn't).

**Verify**: `grep -n "redact" src/main/logger.ts` → at least one call site.

### Step 5: Changelog + full gate

CHANGELOG `[Unreleased]` → `### Security`:
`- Log redaction now covers nested objects and credentials embedded in strings (URLs, Bearer headers).`

**Verify**: `pnpm check` → exit 0.

## Test plan

Covered in step 1 — six new cases in `src/shared/logger.test.ts`, modeled on
the existing tests in that file. Final: `pnpm test src/shared/logger` all pass.

## Done criteria

- [ ] `pnpm check` exits 0
- [ ] New redaction tests (nested, array, URL-credential, bearer, cycle) exist and pass
- [ ] `scrubString` exported from `src/shared/logger.ts` and used in `app:copyDiagnostics`
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] CHANGELOG Security entry present
- [ ] `plans/README.md` status row updated

## STOP conditions

- `src/main/logger.ts` turns out to have its own divergent redaction logic
  that conflicts structurally with the shared one — report rather than
  unifying ad hoc (that's a small refactor decision for the owner).
- Any existing test depends on the old shallow behavior (i.e. asserts a nested
  secret is NOT redacted) — that would mean shallow redaction is somewhere
  load-bearing; report it.

## Maintenance notes

- Plan 003 (RepoCache token handling) builds on `scrubString` — keep its
  signature stable.
- Reviewer should scrutinize the regexes for catastrophic backtracking (keep
  them linear; the two given above are safe).
- Deliberately deferred: scrubbing the `msg` (first) argument of log calls.
  By convention messages are static event names ("git.cache.error"); if that
  convention ever loosens, extend scrubbing to `msg` too.
