# Plan 001: Bump vitest and vite past known critical/high advisories

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1278cf3..HEAD -- package.json pnpm-lock.yaml vitest.config.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security (dependencies)
- **Planned at**: commit `1278cf3`, 2026-06-12

## Why this matters

`pnpm audit` reports two CRITICAL advisories against vitest 3.0.0 (remote code
execution and arbitrary file read when the vitest API/UI server is listening —
a developer running `pnpm test:watch` while browsing a malicious site is the
attack scenario) and one HIGH against vite 6.0.3 (arbitrary file read via the
dev-server WebSocket). These are dev-machine risks, not shipped-binary risks,
but the fixes are within-major version bumps with negligible breakage risk.

## Current state

- `package.json:97-98` — `"vite": "6.0.3"`, `"vitest": "3.0.0"` in devDependencies.
- `package.json:82` — `"@vitest/coverage-v8": "3.0.0"` (must stay in lockstep with vitest).
- Advisories (from `pnpm audit`, 2026-06-12):
  - vitest CRITICAL: RCE when API server listening — patched `>=3.0.5`.
  - vitest CRITICAL: UI server arbitrary file read/execute — patched `>=3.2.6`.
  - vite HIGH: arbitrary file read via dev-server WebSocket — patched `>=6.4.2`
    (vulnerable `>=6.0.0 <=6.4.1`). Note vite is reachable both as a direct
    devDependency and transitively via `@tailwindcss/vite@^4.3.0`.
- Baseline at planning time: `pnpm typecheck` exits 0; `pnpm test` = 26 files,
  357 tests, all pass.
- Package manager is **pnpm only** (project rule — never npm/yarn).

## Commands you will need

| Purpose   | Command              | Expected on success |
|-----------|----------------------|---------------------|
| Install   | `pnpm install`       | exit 0              |
| Typecheck | `pnpm typecheck`     | exit 0, no errors   |
| Tests     | `pnpm test`          | 357+ tests pass     |
| Full gate | `pnpm check`         | exit 0              |
| Audit     | `pnpm audit`         | no vitest/vite advisories remaining |

## Scope

**In scope** (the only files you should modify):
- `package.json`
- `pnpm-lock.yaml` (via `pnpm install`, never by hand)
- `CHANGELOG.md` (add a `Security` entry under `[Unreleased]`)

**Out of scope**:
- Any other dependency bump (electron, electron-builder, tar chain). The electron runtime upgrade is plan 009; do not fold it in here.
- `vitest.config.ts` — only touch if a verification step fails and the fix is a documented vitest 3.x config rename (then record it in the commit body).

## Git workflow

- **Never commit to `main`** (project rule). Branch: `chore/bump-vitest-vite-security`
- One commit, conventional style, e.g.:
  `chore: bump vitest to 3.2.x and vite to 6.4.x for security advisories`
- Body should name the advisory IDs (GHSA) from `pnpm audit` output.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Bump the three packages

In `package.json` devDependencies set:
- `"vitest": "3.2.6"` (or latest 3.x ≥ 3.2.6)
- `"@vitest/coverage-v8": "3.2.6"` (same version as vitest)
- `"vite": "6.4.2"` (or latest 6.x ≥ 6.4.2)

Then run `pnpm install`.

**Verify**: `pnpm install` → exit 0; `pnpm ls vitest vite @vitest/coverage-v8` shows the new versions.

### Step 2: Run the full verification gate

**Verify**: `pnpm check` → exit 0 (typecheck + lint + format + 357+ tests pass).

### Step 3: Confirm the advisories are gone

**Verify**: `pnpm audit 2>&1 | grep -iE "vitest|^.*vite "` → no CRITICAL/HIGH rows for vitest or vite. (Other advisories — electron, tar, form-data — will remain; they are out of scope here.)

### Step 4: Changelog entry

Add under `[Unreleased]` → `### Security` in `CHANGELOG.md`:
`- Updated dev tooling (vitest, vite) past known security advisories affecting the local dev server.`

**Verify**: `git diff CHANGELOG.md` shows exactly one added line in the Security section.

## Test plan

No new tests — this is a dependency bump validated by the existing suite
(357 tests) plus `pnpm check`.

## Done criteria

- [ ] `pnpm check` exits 0
- [ ] `pnpm audit` shows no vitest or vite advisories
- [ ] `package.json` shows vitest ≥ 3.2.6, @vitest/coverage-v8 matching, vite ≥ 6.4.2
- [ ] CHANGELOG.md `[Unreleased]` has the Security entry
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `pnpm install` cannot resolve vitest 3.2.x with `@vitest/coverage-v8`
  (peer conflict) — report the resolution error verbatim.
- More than 3 tests fail after the bump (a behavior change in vitest 3.2,
  e.g. fake-timer or snapshot semantics) — do not rewrite tests to pass;
  report which ones fail and why.
- `@tailwindcss/vite@4.3.0` declares a peer range that excludes vite 6.4.x.

## Maintenance notes

- vitest and `@vitest/coverage-v8` must always be bumped together.
- The remaining `pnpm audit` noise (tar, form-data, tmp) is all in the
  electron-builder / electron-icon-builder build chain — dev-time only,
  deliberately not fixed here. The electron runtime advisories are plan 009.
