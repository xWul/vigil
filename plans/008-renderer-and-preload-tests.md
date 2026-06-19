# Plan 008: Add component tests for renderer and preload

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1278cf3..HEAD -- src/renderer/ src/preload/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (additive — tests only)
- **Depends on**: plans/007-split-workspace-screen.md
- **Category**: tests
- **Planned at**: commit `1278cf3`, 2026-06-12

## Why this matters

The renderer (~8,200 lines across 7 source files) and preload bridge (22
lines) have zero test coverage. The renderer contains keyboard navigation
logic, finding selection, tab state, queued-comment accumulation, and review
submission flows — all of which users depend on and none of which survive
refactors safely today. This plan adds a baseline test layer: React Testing
Library tests for the two simplest screens (ReviewQueue, Auth) and the
WorkspaceHelpers pure functions extracted by plan 007, plus a unit test for the
preload bridge. These ~30 tests are the foundation the team can build on without
needing a full component test suite all at once.

## Current state

- No test files in `src/renderer/` or `src/preload/` at commit `1278cf3`.
- `vitest.config.ts` — check what environment is configured; Vitest needs
  `environment: "jsdom"` (or happy-dom) for React component tests. Read the
  file before assuming.
- `src/renderer/features/review-queue/ReviewQueue.tsx` — uses TanStack Query
  (`usePRList`) to load the queue; renders a list of PR rows plus a search
  input and keyboard handler.
- `src/renderer/features/auth/Auth.tsx` — renders provider buttons and calls
  `api.invoke("auth:signIn", …)`; simplest screen.
- `src/renderer/lib/queries.ts` — TanStack Query hooks for all IPC calls;
  the test doubles need to wrap components in a `QueryClientProvider`.
- `src/preload/index.ts` — 22 lines; exposes `window.api = { invoke, on }`.
- Plan 007 creates `WorkspaceHelpers.ts` containing pure functions (no
  React, no IPC). Those are trivially testable.
- Test pattern to follow: `src/main/auth/pkce.test.ts` (pure functions),
  `src/main/platforms/GitHubProvider.test.ts` (describe/it/vi.mock structure).
  For React: model after the `@testing-library/react` approach.

## Commands you will need

| Purpose      | Command                               | Expected on success |
|--------------|---------------------------------------|---------------------|
| Install      | `pnpm install`                        | exit 0 (if deps added) |
| Typecheck    | `pnpm typecheck`                      | exit 0              |
| These tests  | `pnpm test src/renderer src/preload`  | all pass            |
| Full gate    | `pnpm check`                          | exit 0              |

## Scope

**In scope**:
- `vitest.config.ts` — add jsdom environment for renderer tests if absent
- `src/renderer/features/workspace/WorkspaceHelpers.test.ts` (create)
- `src/renderer/features/review-queue/ReviewQueue.test.tsx` (create)
- `src/renderer/features/auth/Auth.test.tsx` (create)
- `src/preload/index.test.ts` (create)
- `package.json` — add `@testing-library/react` and `@testing-library/jest-dom`
  if not already installed (check `pnpm ls @testing-library/react` first)
- CHANGELOG is **exempt** — tests-only change per CLAUDE.md

**Out of scope**:
- WorkspaceScreen or AnalysisTabs (too large for this plan; deferred)
- Settings screen
- Adding Playwright E2E (separate concern)
- Changing any production source file to improve testability — if something is
  untestable, note it as a STOP rather than refactoring it here

## Git workflow

- **Never commit to `main`.** Branch: `test/renderer-preload-baseline`
- One commit: `test: add baseline tests for renderer screens and preload bridge`

## Steps

### Step 1: Check and configure the test environment

Read `vitest.config.ts`. If `environment` is not set to `"jsdom"` or
`"happy-dom"`, add it. Vitest supports per-file environment via a comment
(`@vitest-environment jsdom`) so you can also add it per-file to avoid
changing global config — prefer the per-file approach if the global config
is shared with main-process tests that run in Node.

Check if `@testing-library/react` and `@testing-library/jest-dom` are
already installed: `pnpm ls @testing-library/react`. If not, add them to
devDependencies (`pnpm add -D @testing-library/react @testing-library/jest-dom`).

**Verify**: `pnpm install` → exit 0; `pnpm typecheck` → exit 0.

### Step 2: Pure-function tests for WorkspaceHelpers

Create `src/renderer/features/workspace/WorkspaceHelpers.test.ts`.
(This file only exists if plan 007 has landed. If plan 007 is NOT DONE,
skip to step 3 and note the gap.)

Cover at minimum:
- `severityColor("critical")` → the red token value
- `severityColor("info")` → the faint token value  
- `shortPath("src/main/foo/bar.ts")` → `"foo/bar.ts"`
- `shortPath("bar.ts")` → `"bar.ts"`
- `lineId` and `fileId` produce stable, non-empty strings and don't crash on
  paths with special characters
- `formatAge` (if exported): some representative date → expected relative string

**Verify**: `pnpm test src/renderer/features/workspace/WorkspaceHelpers` → all pass.

### Step 3: Preload bridge unit tests

Create `src/preload/index.test.ts`. The preload cannot be imported directly in
Node because it imports from `"electron"`. Mock electron at the top:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockIpcRenderer = {
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
};

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: mockIpcRenderer,
}));
```

Then import the preload module. The `contextBridge.exposeInMainWorld` mock
captures what was registered. Extract the registered `api` object and test:
1. `api.invoke("app:getVersion")` → calls `ipcRenderer.invoke` with
   `"app:getVersion"`.
2. `api.on("review:finding", handler)` → calls `ipcRenderer.on` with the
   channel; the returned unsubscribe function calls `ipcRenderer.removeListener`.
3. The subscription wrapper passes the payload (second arg) not the event
   (first arg) to the handler.

**Verify**: `pnpm test src/preload` → all pass.

### Step 4: Auth screen snapshot of rendered output

Create `src/renderer/features/auth/Auth.test.tsx`. Import from
`@testing-library/react`.

Mock `"../../api.js"` (or its relative path from the test file) to expose
a fake `api.invoke` that resolves immediately. Wrap the component in a
`QueryClientProvider` (required by any screen that uses TanStack Query, even
if Auth itself doesn't — future-proofs the harness). Render `<Auth />` and
assert:

1. Provider buttons (GitHub, Azure DevOps, PAT) are present in the DOM.
2. Clicking "GitHub" button calls `api.invoke("auth:signIn", "github")`.
3. Clicking "Azure DevOps" button calls `api.invoke("auth:signIn", "azure-devops")`.

**Verify**: `pnpm test src/renderer/features/auth` → all pass.

### Step 5: ReviewQueue loading/empty/populated states

Create `src/renderer/features/review-queue/ReviewQueue.test.tsx`.

Mock `api.invoke` to simulate:
1. Loading state: promise never resolves → component renders a loading indicator
   (or at minimum does not render PR rows).
2. Empty queue: `ok([])` → empty-state message renders.
3. Populated: `ok([{ title: "Fix bug", platform: "github", … }])` → PR title
   appears. Use the minimal PR shape from the model; check
   `src/shared/model/index.ts` for required fields.
4. Error state: `err({ code: "platform_error", message: "…" })` → error
   message renders (or at minimum no crash).

The `ReviewQueue` uses TanStack Query; wrap with `QueryClientProvider` and set
`staleTime: Infinity` so queries don't immediately refetch in tests.

**Verify**: `pnpm test src/renderer/features/review-queue` → all pass.
**Verify**: `pnpm check` → exit 0.

## Test plan

Summarized: ~25–35 tests across 4 new files:
- `WorkspaceHelpers.test.ts`: ~8 pure-function assertions
- `index.test.ts` (preload): ~5 bridge behavior tests
- `Auth.test.tsx`: ~3 render + interaction tests
- `ReviewQueue.test.tsx`: ~4 state-variation tests

## Done criteria

- [ ] `pnpm test src/renderer src/preload` → all new tests pass
- [ ] `pnpm check` exits 0
- [ ] Preload bridge test exists and includes the payload-not-event assertion
- [ ] ReviewQueue empty + populated states both tested
- [ ] Auth button → api.invoke path tested
- [ ] No production source files modified
- [ ] `plans/README.md` status row updated

## STOP conditions

- `vi.mock("electron", …)` doesn't work for the preload because electron types
  cause module resolution failures — report the exact error; do not attempt to
  re-export electron as a barrel.
- `@testing-library/react` and the installed React version are incompatible
  (check peer requirements before installing) — report.
- Auth or ReviewQueue cannot be rendered in isolation because they import
  something that cannot be mocked (an Electron main-process module accidentally
  reachable from the renderer bundle) — this is a layering violation; report
  the import chain rather than patching around it.

## Maintenance notes

- Every new screen added to `src/renderer/features/` should include a
  co-located `.test.tsx`. Reviewers should ask for it.
- The `QueryClientProvider` wrapper used in steps 4–5 should be extracted to
  a shared test helper (`src/renderer/test-utils.tsx`) once three or more tests
  need it — don't do that premature extraction now.
- WorkspaceScreen tests are the natural next plan — plan 007's split is the
  prerequisite for making them practical.
