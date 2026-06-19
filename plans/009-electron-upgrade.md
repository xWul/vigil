# Plan 009: Upgrade Electron 33 → 39+ to clear runtime security advisories

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1278cf3..HEAD -- package.json electron.vite.config.ts src/main/index.ts src/preload/index.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: HIGH (major version bump of the application runtime; test on
  macOS AND Windows before merging)
- **Depends on**: plans/001-bump-vitest-vite-security-patches.md, plans/005-electron-enable-sandbox.md
- **Category**: security / migration
- **Planned at**: commit `1278cf3`, 2026-06-12

## Why this matters

`pnpm audit` shows four HIGH advisories against `electron@33.2.1` that affect
the **shipped binary**, not just dev tooling:

| Advisory | Patched version |
|---|---|
| Use-after-free in offscreen child window paint callback | ≥ 39.8.1 |
| Use-after-free in WebContents fullscreen/pointer-lock/keyboard-lock | ≥ 38.8.6 |
| Use-after-free in PowerMonitor on Windows and macOS | ≥ 38.8.6 |
| Renderer command-line switch injection via undocumented webPreference | ≥ 38.8.6 |

Plus one LOW (clipboard crash on malformed data, patched ≥ 39.8.5).

Electron 33 was released January 2025; its support window typically ends when
it's 6 majors behind current. The `sandbox: true` change in plan 005 reduces
risk on the renderer side but the PowerMonitor and WebContents use-after-frees
are main-process CVEs that sandbox doesn't mitigate.

## Current state

- `package.json:83` — `"electron": "33.2.1"` in devDependencies.
- `package.json:85` — `"electron-builder": "25.1.8"`.
- `src/main/index.ts` — main process entry; uses `app`, `BrowserWindow`,
  `nativeImage`, `shell`, `Notification`. Must be verified post-upgrade.
- `src/preload/index.ts` — uses `contextBridge`, `ipcRenderer`.
- `src/main/updater.ts` — uses `electron-updater`; check API compat.
- `@types/node: "24.0.0"` — already pinned to Node 24; should be fine.
- The `@napi-rs/keyring` native module must be rebuilt against the new
  Electron's Node.js ABI. `electron-builder` does this automatically via
  `@electron/rebuild` when packaging.
- Target: Electron **39** (the lowest version clearing all HIGH advisories).
  If 39 is not yet available in the pnpm registry as a stable release, target
  the latest stable that is ≥ 38.8.6 (likely 38.x or 40.x — check before bumping).

## Commands you will need

| Purpose        | Command                                     | Expected on success |
|----------------|---------------------------------------------|---------------------|
| Install        | `pnpm install`                              | exit 0              |
| Typecheck      | `pnpm typecheck`                            | exit 0              |
| Tests          | `pnpm test`                                 | 357+ tests pass     |
| Dev launch     | `pnpm dev`                                  | app opens           |
| Package (mac)  | `pnpm dist:mac`                             | .dmg produced       |
| Audit check    | `pnpm audit 2>&1 \| grep -i "electron"`    | no HIGH/CRIT rows   |
| ABI check      | `pnpm electron-builder install-app-deps`    | rebuilds native mods|

## Scope

**In scope**:
- `package.json` (electron, electron-builder, @types/node versions)
- `pnpm-lock.yaml` (via `pnpm install`)
- `src/main/index.ts` — if any Electron API changed in 33→39
- `src/main/updater.ts` — if `electron-updater` needs a matching bump
- `src/preload/index.ts` — if preload API changed (unlikely)
- CHANGELOG.md

**Out of scope**:
- `electron-vite` version — bump only if required by the new electron version
  (check peer deps after install and bump minimally).
- Any code logic changes beyond fixing API incompatibilities (this is a
  dependency upgrade, not a feature change).
- CI release workflow — GitHub Actions `runs-on: macos-latest` will use
  whatever Electron version the lockfile specifies.

## Git workflow

- **Never commit to `main`.** Branch: `chore/electron-39-upgrade`
- Conventional commit: `chore: upgrade Electron 33 → 39 to clear runtime security advisories`
- Changelog entry in the same commit.

## Steps

### Step 1: Determine the target version

Run: `pnpm info electron versions --json | node -e "const v=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(v.filter(s=>parseInt(s)>=39).slice(-5))"`

Pick the latest stable 39.x (or 40.x if 39 is EOL). Confirm it's stable
(not alpha/beta). Record the exact version chosen.

**Verify**: version string is `39.x.y` or higher, stable.

### Step 2: Bump electron (and electron-builder if needed)

In `package.json`:
- Set `"electron"` to the target version from step 1.
- Set `"electron-builder"` to its latest version compatible with the new
  electron: check `pnpm info electron-builder` for the current latest.

Run `pnpm install`.

**Verify**: `pnpm install` exits 0; `pnpm ls electron` shows new version.

### Step 3: Check for API breaking changes

Read the Electron migration guides from 33 to your target version. The most
likely breaking changes across 33→39:

- `app.dock` property access pattern on non-macOS (unchanged — already guarded
  by `process.platform === "darwin"` in `src/main/index.ts:67`).
- `Notification` constructor options — unchanged.
- `shell.openExternal` — unchanged.
- `ipcRenderer.invoke` / `ipcMain.handle` — unchanged.
- `contextBridge.exposeInMainWorld` — unchanged.

Run typecheck to surface any type-level breakage:

**Verify**: `pnpm typecheck` → exit 0. If not, fix only the minimum required
to restore type correctness; do not refactor.

### Step 4: Run the full test suite

**Verify**: `pnpm test` → 357+ tests pass.

### Step 5: Rebuild native modules

`@napi-rs/keyring` is a native module that must be compiled against the new
Electron ABI. electron-builder handles this automatically at package time, but
verify it in dev:

```bash
./node_modules/.bin/electron-rebuild -f -w @napi-rs/keyring
```

If `electron-rebuild` is not in node_modules, use:
```bash
npx @electron/rebuild -f -w @napi-rs/keyring
```

**Verify**: command exits 0; `pnpm dev` opens the app; signing in to the
keychain (Settings screen, entering an API key) does not crash.

### Step 6: Smoke-test the packaged app (macOS)

```bash
pnpm dist:mac
```

Open the produced `.app` from `dist/mac/`. Confirm it launches and renders the
Review Queue. If code signing is not configured on this machine, the `.app`
will still launch when explicitly opened via Finder (right-click → Open).

**Verify**: app opens, Review Queue renders, no main-process crash in
`~/Library/Logs/vigil/vigil.log`.

### Step 7: Confirm audit clear

**Verify**: `pnpm audit 2>&1 | grep -iE "electron.*HIGH|electron.*CRITICAL"` → no matches.

### Step 8: Changelog + full gate

CHANGELOG `[Unreleased]` → `### Security`:
`- Upgraded Electron to 39.x, clearing four HIGH runtime security advisories (use-after-free in WebContents, PowerMonitor; command-line switch injection).`

**Verify**: `pnpm check` → exit 0.

## Test plan

No new tests — this is a dependency upgrade. Correctness validated by the
existing 357-test suite + packaged-app smoke (step 6).

## Done criteria

- [ ] `pnpm ls electron` shows 39.x or higher
- [ ] `pnpm audit` shows no HIGH or CRITICAL electron advisories
- [ ] `pnpm test` exits 0 (357+ tests)
- [ ] `pnpm dist:mac` produces a launchable `.app`
- [ ] CHANGELOG Security entry present
- [ ] No files outside in-scope list modified (beyond lockfile)
- [ ] `plans/README.md` status row updated

## STOP conditions

- `pnpm install` fails with a peer-conflict between the new electron and
  `electron-vite`, `electron-builder`, or `@napi-rs/keyring` — report the
  exact conflict; do not downgrade the electron target to resolve it.
- `pnpm typecheck` fails with errors that require logic changes beyond fixing
  API renames — report; do not refactor business logic as part of this plan.
- `electron-rebuild` for `@napi-rs/keyring` fails and cannot be fixed by a
  simple version bump of the package — report; this is a blocker requiring
  maintainer decision.
- Packaged app crashes at startup (not just signing rejection) — attach the
  log from `~/Library/Logs/vigil/vigil.log` in the report.

## Maintenance notes

- After this upgrade, set up Dependabot or Renovate to track Electron major
  releases. Electron typically EOLs each major after ~3 majors of lag.
- The tar/form-data/tmp advisories in `pnpm audit` (from electron-builder's
  dep chain) will likely reduce with the electron-builder bump here but may
  not fully clear. They are build-time-only and low-priority.
- `electron-updater` may need a matching version bump if it depends on Electron
  internals — check release notes.
