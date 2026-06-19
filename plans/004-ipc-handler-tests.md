# Plan 004: Put the IPC handler layer under test

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1278cf3..HEAD -- src/main/ipc/ src/shared/ipc-contract.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW (additive — tests only, no production code changes expected)
- **Depends on**: none (plan 005 depends on THIS plan)
- **Category**: tests
- **Planned at**: commit `1278cf3`, 2026-06-12

## Why this matters

`src/main/ipc/index.ts` (514 lines, 25 channels) is the orchestration layer
every renderer interaction crosses — auth, PR fetching, review runs, settings.
It is the highest-churn source file in the repo (6 of the last 40 commits) and
has **zero test coverage**. Bugs here (wrong session loaded, error envelope
malformed, provider constructed with wrong args) reach the user before any
other safety net. Plan 005 changes this file's Azure DevOps logic; these tests
must exist first so that change lands against a green harness.

## Current state

- `src/main/ipc/handlers.ts` (10 lines) — the typed registration helper:

```typescript
// src/main/ipc/handlers.ts:5-10
export function handle<K extends keyof IpcContract>(
  channel: K,
  handler: (...args: Parameters<IpcContract[K]>) => Promise<ReturnType<IpcContract[K]>>,
): void {
  ipcMain.handle(channel, (_event, ...args) => handler(...(args as Parameters<IpcContract[K]>)));
}
```

- `src/main/ipc/index.ts` — `registerHandlers(tokenStore, settingsStore,
  logger, reviewCache, repoCache, updater)` registers all channels. Key
  behaviors worth pinning (read the file; line refs at `1278cf3`):
  - `loadSession` (52-59): tries `tokenStore.load(platform)`, falls back to
    `tokenStore.load("pat-" + platform)`.
  - `sessionToAccount` (42-50): maps `AuthSession → ConnectedAccount`; PAT
    sessions map to `displayName: "PAT user", login: "pat"`.
  - `auth:getAccounts` (138-146): iterates both platforms, returns
    `ok(ConnectedAccount[])`. **Must never include tokens in the payload** —
    this is the security property most worth a regression test.
  - `platform:getPRWithDiff` (170-189): no session → `err({ code: "forbidden" })`;
    otherwise `Promise.all` of `getPullRequest` + `getDiff`.
  - `review:getCached` (345), `review:invalidate` (347-350): thin wrappers
    over `ReviewCache`.
  - `settings:get` / `settings:set` / `settings:setApiKey` (412-450): wrap
    SettingsStore; failures → `err({ code: "write_failed", message })`.
- Electron imports at the top of `index.ts`: `app, BrowserWindow, clipboard,
  dialog, shell, Notification` — and `ipcMain` inside `handlers.ts`. All must
  be mocked since tests run in Node, not Electron.
- Available real (non-keychain) fakes, designed for exactly this use:
  - `src/main/auth/FileTokenStore.ts` — TokenStore persisting JSON at a path.
  - `src/main/settings/SecretStore.ts` — contains `FileSecretStore`.
  - `src/main/settings/SettingsStore.ts` — takes `(settingsJsonPath, secretStore)`.
  - `src/main/ai/ReviewCache.ts` — takes a directory path.
  - `src/main/git/RepoCache.ts` — takes `(cacheDir, logger)`.
- HTTP mocking: `msw` is a devDependency; `src/main/platforms/GitHubProvider.test.ts`
  and `AzureDevOpsProvider.test.ts` already use it — copy their server
  setup/teardown pattern exactly.
- Session fixture shapes: copy from `src/main/git/RepoCache.test.ts:21-31`
  (`githubSession`, `patSession`).
- Test conventions (CLAUDE.md): co-located file → `src/main/ipc/index.test.ts`;
  test behavior, not implementation; mock the boundary (electron, network,
  filesystem→tmp dirs), not the unit.

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| This test | `pnpm test src/main/ipc`         | all pass            |
| Typecheck | `pnpm typecheck`                 | exit 0              |
| Full gate | `pnpm check`                     | exit 0              |

## Scope

**In scope**:
- `src/main/ipc/index.test.ts` (create)
- `src/main/ipc/index.ts` — ONLY if a minimal testability seam is unavoidable
  (see STOP conditions; prefer zero production changes)

**Out of scope**:
- `src/main/ipc/handlers.ts` — covered implicitly via the electron mock.
- Testing `review:run` end-to-end with AI providers — too much surface; cover
  only its early "no session" error path.
- `auth:signIn` interactive flows (device flow / browser) — covered by
  existing auth provider tests; skip here.
- Renderer, preload — separate plans (010).
- CHANGELOG — tests-only changes are explicitly exempt per CLAUDE.md.

## Git workflow

- **Never commit to `main`.** Branch: `test/ipc-handler-coverage`
- Conventional commit, e.g. `test: add coverage for IPC handler layer`

## Steps

### Step 1: Electron mock + harness scaffolding

Create `src/main/ipc/index.test.ts`. At the top (before imports of the module
under test), mock electron:

```typescript
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, (...args: unknown[]) => fn(undefined, ...args));
    },
  },
  app: { getVersion: () => "0.0.0-test", getPath: () => "/tmp/vigil-test-unused" },
  BrowserWindow: { getAllWindows: () => [] },
  clipboard: { writeText: vi.fn() },
  dialog: { showMessageBox: vi.fn() },
  shell: { openExternal: vi.fn() },
  Notification: Object.assign(vi.fn(), { isSupported: () => false }),
}));
```

Then a `setup()` helper that builds the dependency set in a fresh
`mkdtempSync` temp dir per test: `FileTokenStore`, `SettingsStore` (with
`FileSecretStore`), `ReviewCache`, `RepoCache`, `NoopLogger`, `updater: null`,
calls `registerHandlers(...)`, and returns a typed
`invoke(channel, ...args)` that looks up `handlers`. Clear the `handlers` map
and temp dirs in `beforeEach`/`afterEach` (pattern: `RepoCache.test.ts`).

`registerHandlers` is registration-time side-effect only; calling it twice in
one process would double-register in real Electron, but with the map-mock each
`setup()` simply overwrites — note this in a comment.

**Verify**: a trivial first test — `invoke("app:getVersion")` resolves to
`{ ok: true, value: "0.0.0-test" }` — passes: `pnpm test src/main/ipc`.

### Step 2: Auth family

Tests:
1. `auth:getAccounts` with empty token store → `ok([])`.
2. Seed FileTokenStore with a github session (fixture from RepoCache.test.ts)
   → `auth:getAccounts` returns one ConnectedAccount with
   `platform/displayName/login` and — assert explicitly —
   `JSON.stringify(result)` does NOT contain the fixture token string.
3. Seed only `pat-github` key → account still found (fallback path), login `"pat"`.
4. `auth:signOut` with no stored session → `ok(undefined)` (idempotent).

**Verify**: `pnpm test src/main/ipc` → all pass.

### Step 3: Platform family (MSW)

Copy the MSW server setup from `src/main/platforms/GitHubProvider.test.ts`.
Tests:
1. `platform:getPRWithDiff` with no session → `err` with `code: "forbidden"`.
2. `platform:listPRs` with no sessions at all → `ok([])`.
3. (Happy path) Seed a github session; MSW-stub the octokit endpoints the
   GitHubProvider tests already stub for `listOpenPullRequests`; expect the
   normalized PRs to flow through. If wiring the full octokit surface is
   disproportionate, keep 1–2 endpoint stubs and assert shape only
   (`Array.isArray(result.value)`).

**Verify**: `pnpm test src/main/ipc` → all pass.

### Step 4: Review + settings families

Tests:
1. `review:getCached` unknown sha → `ok(null)` (confirm actual ReviewCache
   miss value by reading `src/main/ai/ReviewCache.ts` — adjust expectation to
   its real return).
2. `review:invalidate` then `review:getCached` → miss.
3. `settings:get` fresh store → defaults with `hasAnthropicKey: false`.
4. `settings:setApiKey("anthropic", "test-key-123")` then `settings:get` →
   `hasAnthropicKey: true`; and the Settings payload does NOT contain
   `"test-key-123"` anywhere (renderer-never-sees-keys property).
5. `settings:setAnalyzerConfig` + `settings:getAnalyzerConfig` round-trip for
   a github ref fixture.
6. `review:run` with no session → `err` with `code: "network"` (current
   behavior at index.ts:248 — pin it).

**Verify**: `pnpm test src/main/ipc` → all pass; `pnpm check` → exit 0.

## Test plan

(The steps above ARE the test plan — ~14 tests across 4 families.) Structural
patterns: MSW from `GitHubProvider.test.ts`, temp dirs/fixtures from
`RepoCache.test.ts`.

## Done criteria

- [ ] `src/main/ipc/index.test.ts` exists with ≥ 12 passing tests covering all four families
- [ ] Two security-property tests present: getAccounts payload contains no token; settings payload contains no API key
- [ ] `pnpm check` exits 0
- [ ] Zero (or explicitly justified minimal) changes to production files (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- `vi.mock("electron")` fails because some transitive import requires a real
  Electron binary at module scope — report which import; do not introduce a
  DI refactor of index.ts on your own.
- You find yourself needing to modify `src/main/ipc/index.ts` for more than a
  trivial export — that's a design decision for the owner; report it.
- MSW interception fails for octokit (undici/fetch mismatch) after copying the
  working pattern from GitHubProvider.test.ts — report the error rather than
  swapping HTTP-mocking libraries.

## Maintenance notes

- Every new IPC channel added to `src/shared/ipc-contract.ts` should get at
  least one happy-path and one error-envelope test here — reviewers should
  ask for it.
- Plan 005 (ADO org discovery) will extend the `platform:listPRs` tests in
  this file.
- The two "no secret in payload" tests are the executable form of the
  CLAUDE.md rule "the renderer never sees secrets" — never delete them to
  make a refactor pass.
