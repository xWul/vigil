# Plan 005: Enable Electron renderer sandbox

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1278cf3..HEAD -- src/main/index.ts src/preload/index.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `1278cf3`, 2026-06-12

## Why this matters

Vigil's BrowserWindow is created with `sandbox: false`. Electron's sandbox
(Chromium process sandbox + restricted Node.js access in the renderer) is a
defence-in-depth boundary: even if a malicious dependency or a compromised npm
package gets into the renderer bundle, sandbox containment means it cannot
reach Node.js APIs directly. With `contextIsolation: true` already in place,
enabling `sandbox: true` closes the remaining gap. Electron's own security
documentation marks disabling the sandbox as a security misconfiguration.

The preload (`src/preload/index.ts`) only imports `contextBridge` and
`ipcRenderer` — both explicitly supported inside the Electron sandboxed preload
environment. Enabling sandbox does not restrict either of those APIs.

## Current state

- `src/main/index.ts:38-44` — window creation:

```typescript
// src/main/index.ts:38-44
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
```

- `src/preload/index.ts:1-22` — uses only `contextBridge` and `ipcRenderer`;
  no `require()`, no `process.env`, no `fs` — compatible with sandbox mode.

## Commands you will need

| Purpose       | Command              | Expected on success |
|---------------|----------------------|---------------------|
| Typecheck     | `pnpm typecheck`     | exit 0              |
| Full gate     | `pnpm check`         | exit 0              |
| Dev launch    | `pnpm dev`           | app opens, no JS errors in DevTools console |

## Scope

**In scope**:
- `src/main/index.ts` (one-line change)
- `CHANGELOG.md`

**Out of scope**:
- Anything in `src/preload/` — the existing preload is already sandbox-compatible.
- Renderer code — sandbox mode does not change what the renderer can do via
  the `contextBridge`-exposed `window.api`.

## Git workflow

- **Never commit to `main`.** Branch: `fix/enable-renderer-sandbox`
- `fix: enable Electron renderer sandbox`

## Steps

### Step 1: Change `sandbox: false` to `sandbox: true`

In `src/main/index.ts` line 42, change `sandbox: false` to `sandbox: true`.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Smoke-test the running app

Launch `pnpm dev`. Open Electron DevTools (View → Toggle Developer Tools).
Confirm: no errors in the console; `window.api` is present and callable
(`window.api.invoke("app:getVersion")` should resolve). Navigate to Settings,
confirm the screen loads.

If `pnpm dev` is not available in this environment, skip to step 3 and note
it in the PR description as untested at runtime.

**Verify**: No `ReferenceError`, no `contextBridge`-related errors in DevTools.

### Step 3: Changelog + full gate

CHANGELOG `[Unreleased]` → `### Security`:
`- Enabled Electron renderer sandbox (defense-in-depth against renderer-side compromise).`

**Verify**: `pnpm check` → exit 0.

## Test plan

No new automated tests — the change is a one-liner; correctness at runtime is
verified in step 2 (manual smoke), and `pnpm check` confirms nothing breaks
statically.

## Done criteria

- [ ] `grep 'sandbox' src/main/index.ts` shows `sandbox: true`
- [ ] `pnpm check` exits 0
- [ ] CHANGELOG Security entry present
- [ ] No files outside in-scope list modified
- [ ] `plans/README.md` status row updated

## STOP conditions

- The app fails to start or DevTools shows `contextBridge not accessible` /
  `ipcRenderer not available` — this means the preload is using a restricted
  API in sandboxed mode; report the exact error and the preload line it
  originated from.
- TypeScript errors referencing preload types — report.

## Maintenance notes

- If a future preload change needs Node.js APIs beyond `contextBridge` /
  `ipcRenderer`, the developer will need a justified reason to revert this.
  That justification should be an ADR update, not a quiet flip back to `false`.
