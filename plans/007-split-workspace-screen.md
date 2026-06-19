# Plan 007: Split WorkspaceScreen into focused sub-modules

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1278cf3..HEAD -- src/renderer/features/workspace/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED (refactor of the most complex UI file; no behavior change)
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `1278cf3`, 2026-06-12

## Why this matters

`WorkspaceScreen.tsx` is 3,470 lines — roughly 11× the 300-line module
guideline from CLAUDE.md. It contains at least 8 logically distinct concerns
in a single file: diff rendering, the findings panel, the review draft
composer, the challenge (AI conversation) panel, the analyzer settings overlay,
inline comment threads, the help overlay, and top/bottom navigation strips. Any
change to one concern requires navigating and risking the rest. The file is on
the high-churn list and has no tests; splitting it is the prerequisite for
making it testable (plan 008 adds the tests).

**Goal**: extract clearly-bounded sub-components into their own files, each
≤ 400 lines, with `WorkspaceScreen.tsx` reduced to ~300 lines of orchestration
that holds the shared state and composes the pieces.

## Current state — structure map

(Read the file top to bottom to validate before starting. Line numbers are
approximate at commit `1278cf3`.)

```
src/renderer/features/workspace/
  WorkspaceScreen.tsx         (3 470 lines — everything)
  AnalysisTabs.tsx            (1 685 lines)
  WorkspacePreview.tsx          (601 lines)
```

Logical blocks inside `WorkspaceScreen.tsx`:
- Lines 1–70: imports, type defs, diff color tokens, helper fns
- Lines 73–143: pure helpers (`severityColor`, `shortPath`, `lineId`,
  `fileId`, `hunkKey`, `findingKey`, `formatAge`, `extractHunkContext`,
  `reviewSummary`)
- Lines 145–180: `KbdHint` component
- Lines 180–248: `HelpOverlay` component
- Lines 248–473: `SettingsToggle`, `SettingsNumber`, `SettingsSection`
  sub-components — all part of `AnalyzerSettingsOverlay`
- Lines 473–924: `AnalyzerSettingsOverlay` component + supporting hooks
- Lines 924–1039: `TopStrip` (PR header bar)
- Lines 1039–1210: `FileRail` (left file list nav)
- Lines 1210–1395: `InlineFindingRow`
- Lines 1395–1575: `InlineThread`
- Lines 1575–1718: `PendingComment`, `FreeformCompose`
- Lines 1718–2107: `DiffRow`, `HunkBlock`, `FileSection`, `DiffSkeleton`,
  `DiffCenter` — the diff renderer
- Lines 2107–2305: `ConversationPanel`
- Lines 2305–2499: `VerdictCompose`
- Lines 2499–2609: `BottomStrip`
- Lines 2609–2820: shared state variables, callbacks, keyboard handler,
  misc helpers
- Lines 2820–end: `workspaceTabKey`, `WorkspaceScreen` root (orchestrator)

Target module layout:
```
src/renderer/features/workspace/
  WorkspaceScreen.tsx        (orchestrator only, ~300 lines)
  AnalysisTabs.tsx           (unchanged)
  WorkspacePreview.tsx       (unchanged)
  DiffView.tsx               (DiffRow, HunkBlock, FileSection, DiffSkeleton, DiffCenter)
  FindingsPanel.tsx          (InlineFindingRow — finding markers, gutter dots)
  ThreadPanel.tsx            (InlineThread, PendingComment, FreeformCompose)
  ConversationPanel.tsx      (ConversationPanel, ChallengeState types)
  ReviewDraftPanel.tsx       (VerdictCompose)
  AnalyzerSettingsOverlay.tsx (AnalyzerSettingsOverlay + its sub-components)
  WorkspaceHelpers.ts        (pure helpers + types: severityColor, shortPath, lineId, …)
  TopStrip.tsx               (TopStrip)
  BottomStrip.tsx            (BottomStrip, KbdHint, HelpOverlay)
  FileRail.tsx               (FileRail)
```

## Repo conventions that must be honored

From CLAUDE.md:
- React component return types are NOT annotated (React 19 — let TypeScript
  infer). Look at `AnalysisTabs.tsx` as the current exemplar.
- Prefer event handlers and `useMemo` over `useEffect`; `useEffect` only for
  subscriptions/DOM side effects.
- Functional style. Small, focused modules ≤ 300 lines.
- No business logic in the renderer.
- Imports ordered: node built-ins, external packages, internal absolute,
  relative. Blank line between groups.
- `PascalCase` for types/components, `camelCase` for functions/variables.

## Commands you will need

| Purpose   | Command                                    | Expected on success |
|-----------|--------------------------------------------|---------------------|
| Typecheck | `pnpm typecheck`                           | exit 0              |
| Full gate | `pnpm check`                               | exit 0              |
| Dev launch | `pnpm dev`                                | app opens, workspace renders |

## Scope

**In scope** (the ONLY files you may create or modify):
- `src/renderer/features/workspace/WorkspaceScreen.tsx`
- New files under `src/renderer/features/workspace/` as listed above
- CHANGELOG.md

**Out of scope**:
- `src/renderer/features/workspace/AnalysisTabs.tsx` — already a separate file
- `src/renderer/features/workspace/WorkspacePreview.tsx` — separate file
- Any file outside `src/renderer/features/workspace/`
- No behavior changes — this is a pure structural refactor
- No new external dependencies
- No state shape changes — the same state owned by `WorkspaceScreen` must
  stay there (do not move state into sub-components unless it is truly local)

## Git workflow

- **Never commit to `main`.** Branch: `refactor/split-workspace-screen`
- Commit per extracted file (or group of small files), e.g.:
  `refactor: extract DiffView components from WorkspaceScreen`
  `refactor: extract ReviewDraftPanel and ConversationPanel`
  `refactor: extract helper functions and overlay components`
  `refactor: reduce WorkspaceScreen orchestrator to ~300 lines`
- DO NOT combine behavior changes with this refactor.

## Steps

### Step 1: Extract `WorkspaceHelpers.ts`

Create `src/renderer/features/workspace/WorkspaceHelpers.ts`. Move these pure
functions and types (no component, no JSX, no React import needed):
`severityColor`, `shortPath`, `lineId`, `fileId`, `hunkKey`, `findingKey`,
`formatAge`, `extractHunkContext`, `reviewSummary`, and the diff color tokens
`CODE`. Export all of them.

Update `WorkspaceScreen.tsx` to import them from `./WorkspaceHelpers.js`.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Extract `DiffView.tsx`

Create `src/renderer/features/workspace/DiffView.tsx`. Move: `DiffRow`,
`HunkBlock`, `FileSection`, `DiffSkeleton`, `DiffCenter`, and the
`formatRelativeTime` helper at the top of the diff block.

`DiffCenter` is the component `WorkspaceScreen` renders for the diff tab — it
must be exported. The others are used only within `DiffView.tsx` and need not
be exported.

Props: these components receive `diff`, `findingsByLine`, `threadsByLine`,
`expandedKeys`, `collapsedHunks`, `queuedComments`, and callbacks as props.
Copy the exact prop types from their current function signatures; do not redesign.

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: Extract `ThreadPanel.tsx`

Move `InlineThread`, `PendingComment`, `FreeformCompose`. Export each. Update
`WorkspaceScreen.tsx` and `DiffView.tsx` imports.

**Verify**: `pnpm typecheck` → exit 0.

### Step 4: Extract `FindingsPanel.tsx`

Move `InlineFindingRow`. Export it. Update imports.

**Verify**: `pnpm typecheck` → exit 0.

### Step 5: Extract navigation chrome

- `TopStrip.tsx`: move `TopStrip`. Export it.
- `BottomStrip.tsx`: move `BottomStrip`, `KbdHint`, `HelpOverlay`. Export
  `BottomStrip` and `HelpOverlay`.
- `FileRail.tsx`: move `FileRail`. Export it.

**Verify**: `pnpm typecheck` → exit 0.

### Step 6: Extract `ConversationPanel.tsx` and `ReviewDraftPanel.tsx`

Move `ConversationPanel` to its own file. Move `VerdictCompose` to
`ReviewDraftPanel.tsx` (exported as `ReviewDraftPanel`). Update imports.

**Verify**: `pnpm typecheck` → exit 0.

### Step 7: Extract `AnalyzerSettingsOverlay.tsx`

Move `SettingsToggle`, `SettingsNumber`, `SettingsSection`,
`AnalyzerSettingsOverlay` (and the `toMinimalConfig` helper used only by the
overlay). Export `AnalyzerSettingsOverlay`. Update imports.

**Verify**: `pnpm typecheck` → exit 0.

### Step 8: Reduce `WorkspaceScreen.tsx` to orchestrator

After steps 1–7 `WorkspaceScreen.tsx` should contain only:
- Imports
- The `PassPhase`, `PassMap`, `QueuedComment`, `ConvoMessage`, `ChallengeState`
  types (if not moved to a types file)
- `workspaceTabKey` helper
- `isTabId` guard
- `WorkspaceScreen` root function (state, effects, keyboard handler, JSX
  that composes the extracted sub-components)

Measure: `wc -l src/renderer/features/workspace/WorkspaceScreen.tsx` should
be ≤ 450.

**Verify**: `pnpm typecheck && pnpm lint` → exit 0.

### Step 9: Runtime smoke test + changelog

Launch `pnpm dev`. Click into a PR in the workspace. Verify:
- Diff renders
- Findings appear in the panel
- Tab switching works
- Help overlay (?) opens
- Analyzer settings overlay (,) opens

CHANGELOG `[Unreleased]` → `### Changed`:
`- Refactored WorkspaceScreen into focused sub-modules for readability and future testability.`

**Verify**: `pnpm check` → exit 0.

## Test plan

No new tests in this plan — this is a pure refactor. Plan 008 adds component
tests after the split. Correctness is validated by typecheck, lint, and the
manual smoke test in step 9.

## Done criteria

- [ ] `wc -l src/renderer/features/workspace/WorkspaceScreen.tsx` ≤ 450
- [ ] At least 8 new files created under `src/renderer/features/workspace/`
- [ ] `pnpm check` exits 0
- [ ] App opens and workspace is functional (step 9 smoke)
- [ ] No behavior or state changes — git diff shows only moves
- [ ] CHANGELOG entry present
- [ ] `plans/README.md` status row updated

## STOP conditions

- Circular import between the extracted files and `WorkspaceScreen.tsx`.
  This means a component extracted in an earlier step depends on something
  that should be in a later step — reorder the extractions rather than
  creating a barrel import.
- Any prop-drilling that would require adding a prop to a component that
  previously accessed state via closure. Closures over shared state are
  fine during this refactor — do not switch to Context or Zustand here.
- `wc -l` of a single new file exceeds 600 lines — split it further rather
  than leaving a mini-god-module.

## Maintenance notes

- After this plan, each new UI feature should start as its own file, not an
  addition to an existing file. Reviewers should reject PRs that re-consolidate.
- Plan 008 (renderer tests) depends on this split — the test file per component
  matches the component file created here.
- State that lives in `WorkspaceScreen` and flows down as props is by design
  for this plan. A future plan could hoist shared state into Zustand slices if
  prop chains grow past 4 levels.
