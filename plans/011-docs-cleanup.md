# Plan 011: Fill in missing docs (build-and-release, .env.example, stale ARCHITECTURE reference)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1278cf3..HEAD -- ARCHITECTURE.md docs/ README.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs / dx
- **Planned at**: commit `1278cf3`, 2026-06-12

## Why this matters

Three doc gaps were identified that have concrete user-facing cost:

1. `docs/build-and-release.md` is referenced twice in `ARCHITECTURE.md` as
   `"(TBD)"` for code signing and distribution. v0.1.0 shipped; future
   contributors need this to package or release Vigil.

2. `ARCHITECTURE.md:359` documents `pnpm test:e2e` as a runnable script, but
   `package.json` has no such script. A contributor following the README will
   hit a `"Missing script: test:e2e"` error. The Playwright E2E was deferred
   (ROADMAP Phase 4 open checkbox) — the doc must reflect reality.

3. There is no `.env.example` or documented list of environment variables.
   Four env vars control meaningful behavior (`ANTHROPIC_API_KEY`,
   `OPENAI_API_KEY`, `VIGIL_LOG_LEVEL`, `VIGIL_RUN_GOLDEN_TESTS`) and none
   are mentioned in the README setup section.

## Current state

- `ARCHITECTURE.md:359` — contains:
  ```
  pnpm test:e2e     # Playwright against built app
  ```
  `package.json` — no `test:e2e` script.

- `ARCHITECTURE.md:366` and `ARCHITECTURE.md:376` — both contain:
  ```
  see [`docs/build-and-release.md`](./docs/build-and-release.md) (TBD)
  ```
  `docs/build-and-release.md` — does not exist.

- Environment variables in use (from grepping the codebase):
  - `VIGIL_LOG_LEVEL`: `src/shared/logger.ts:47`, `src/main/logger.ts`
  - `VIGIL_RUN_GOLDEN_TESTS`: documented in ROADMAP, not yet in code (added by plan 010)
  - `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`: used in `scripts/` for dev CLI runs
  - `ELECTRON_RENDERER_URL`: set by electron-vite dev server (internal, not user-facing)

- `docs/setup-oauth-apps.md` — exists and covers OAuth app registration.
- `.github/workflows/release.yml` — the existing release workflow; use it as
  source of truth for the build-and-release doc.
- `package.json:22-31` — `electron-builder` config with `appId`, `publish`,
  `mac`, `win`, `linux` targets.

## Commands you will need

| Purpose   | Command           | Expected on success |
|-----------|-------------------|---------------------|
| Typecheck | `pnpm typecheck`  | exit 0              |
| Full gate | `pnpm check`      | exit 0 (docs changes don't affect this but run to confirm) |

## Scope

**In scope**:
- `docs/build-and-release.md` (create)
- `ARCHITECTURE.md` (two targeted edits only)
- `.env.example` (create at repo root)
- `README.md` — if it's missing an "Environment variables" section, add a
  short one pointing to `.env.example`

**Out of scope**:
- Adding the `test:e2e` script or Playwright setup — that is a test
  infrastructure plan, not a docs plan.
- Changing any source code.
- `CHANGELOG.md` — docs-only changes are exempt per CLAUDE.md rules.

## Git workflow

- **Never commit to `main`.** Branch: `docs/fill-missing-docs`
- Conventional commit: `docs: add build-and-release guide, env.example, fix stale e2e reference`

## Steps

### Step 1: Fix the stale `test:e2e` reference in ARCHITECTURE.md

In `ARCHITECTURE.md:359`, the local dev command block lists:
```
pnpm test:e2e     # Playwright against built app
```

Replace it with:
```
# pnpm test:e2e     # Playwright e2e — not yet implemented (ROADMAP Phase 4)
```

Or remove the line entirely — either is acceptable. The goal is that a reader
does not try to run a nonexistent script.

**Verify**: `grep "test:e2e" ARCHITECTURE.md` → either absent or clearly
marked as unimplemented.

### Step 2: Create `docs/build-and-release.md`

Write a concise guide (~150 lines). Sections:

**Prerequisites**
- macOS: Xcode command line tools, Apple Developer account (for signing)
- Windows: optional code signing certificate

**Build commands** (from package.json scripts):
```bash
pnpm build        # compile TypeScript only
pnpm dist:mac     # macOS .dmg (unsigned if no identity configured)
pnpm dist:win     # Windows NSIS installer
pnpm dist         # all platforms
```

**electron-builder config** — briefly explain the config in `package.json`
(appId, publish.owner/repo for auto-update, mac/win/linux targets).

**GitHub Actions release** — explain that the `.github/workflows/release.yml`
runs on `v*` tag push and `workflow_dispatch`, builds mac + win, publishes to
GitHub Releases via `--publish always` and `GH_TOKEN`. Requires `GITHUB_TOKEN`
(automatic in Actions) — no additional secrets needed for builds; code signing
requires secrets described below.

**macOS code signing** (required for Gatekeeper auto-update approval):
- Generate a Developer ID Application certificate in Apple Developer portal.
- Add `CSC_LINK` (base64-encoded .p12) and `CSC_KEY_PASSWORD` to GitHub
  repository secrets.
- electron-builder reads these automatically.

**Windows code signing** (optional for v0.1, required for no SmartScreen warning):
- Acquire an EV or OV code signing certificate from a CA.
- Add `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` as secrets.

**Auto-update** — explain that `electron-updater` checks GitHub Releases on
startup (packaged builds only). The `publish` config in `package.json` points
to `xWul/vigil`. Code signing is required on macOS for silent updates.

**Versioning** — bump `package.json` `version`, update CHANGELOG, tag `vX.Y.Z`,
push the tag. The release workflow fires automatically.

**Verify**: `docs/build-and-release.md` exists and is valid Markdown (open
in a viewer or run `node -e "require('fs').readFileSync('docs/build-and-release.md','utf-8')"`).

### Step 3: Fix the two `(TBD)` references in ARCHITECTURE.md

In `ARCHITECTURE.md`, replace both instances of:
```
see [`docs/build-and-release.md`](./docs/build-and-release.md) (TBD)
```
with:
```
see [`docs/build-and-release.md`](./docs/build-and-release.md)
```

(Remove the `(TBD)` marker — the file now exists.)

**Verify**: `grep "TBD" ARCHITECTURE.md` → no matches related to build-and-release.

### Step 4: Create `.env.example`

Create at repo root:

```bash
# Vigil environment variables
# Copy this file to .env and fill in values as needed.
# The app stores AI keys in the OS keychain (via Settings screen);
# these vars are for dev CLI scripts (pnpm review, pnpm fetch-pr) only.

# Required for pnpm review <pr-url> CLI
ANTHROPIC_API_KEY=

# Alternative AI provider
OPENAI_API_KEY=

# Log verbosity: error | warn | info | debug (default: error)
VIGIL_LOG_LEVEL=error

# Run golden AI tests (requires ANTHROPIC_API_KEY; makes real API calls)
VIGIL_RUN_GOLDEN_TESTS=
```

**Verify**: `.env.example` exists at repo root; `cat .env.example` shows all four vars.

### Step 5: Add env vars section to README

If README.md has a "Getting Started" or "Development" section but no mention
of environment variables, add a short paragraph:
```
## Environment variables

See `.env.example` for documented variables. Most users never need these —
API keys are stored in the OS keychain via the Settings screen.
```

**Verify**: `grep "env" README.md` → env vars section present.

## Done criteria

- [ ] `docs/build-and-release.md` exists with ≥ the sections listed in step 2
- [ ] `ARCHITECTURE.md` no longer contains the stale `pnpm test:e2e` line (or marks it clearly as unimplemented)
- [ ] Both `(TBD)` markers removed from `ARCHITECTURE.md`
- [ ] `.env.example` exists at repo root with all four documented vars
- [ ] `pnpm check` exits 0
- [ ] No source files modified (`git status` shows only the listed doc files)
- [ ] `plans/README.md` status row updated

## STOP conditions

- `ARCHITECTURE.md` has been significantly restructured since `1278cf3` —
  report the new line numbers for the stale references before editing.
- README.md already has an env-vars section that conflicts with the text
  in step 5 — merge gracefully or skip step 5 and note why.

## Maintenance notes

- When the Playwright E2E is eventually built (deferred ROADMAP item), add
  `pnpm test:e2e` back to `ARCHITECTURE.md` AND to `package.json` in the
  same PR.
- The `docs/build-and-release.md` signing sections will need updates when
  signing credentials are actually configured — that's a user action, not a
  code change.
