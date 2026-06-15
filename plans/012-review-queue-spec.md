# Plan 012: Write the missing review-queue.md specification

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1278cf3..HEAD -- docs/specs/ src/renderer/features/review-queue/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW (documentation only)
- **Depends on**: none
- **Category**: docs / direction
- **Planned at**: commit `1278cf3`, 2026-06-12

## Why this matters

`docs/specs/review-queue.md` is explicitly listed as unchecked (`[ ]`) in
ROADMAP Phase 5, but the feature shipped. Shipping code without a spec leaves
no authoritative record of designed behavior vs. ad-hoc implementation. When
bugs appear (e.g., "why does search include the review summary? is that
intentional?") or when a contributor wants to extend the queue, there is no
spec to consult. The CONTEXT.md glossary has no `ReviewQueue` entry either.

Writing the spec retroactively from the shipped code is also a portfolio
demonstration of design thinking — Vigil's stated goal is to show disciplined
engineering practice to future employers/collaborators (ROADMAP Phase 11 goal).

## Sources of truth for spec content

Read these files before writing — do not invent behavior:

- `src/renderer/features/review-queue/ReviewQueue.tsx` — implementation
  (the spec is derived from this, not the other way around)
- `CHANGELOG.md` v0.1.0 and Unreleased entries that mention the queue
- `ROADMAP.md:220-245` (Phase 5 Review Queue checklist items)
- `CONTEXT.md` — for terms like `PullRequest`, `Finding`, `ReviewResult`,
  `ConnectedAccount` — the spec must use these exact terms
- `docs/specs/review-workspace.md` — sister spec; match its format and depth
- `src/shared/model/index.ts` — `PullRequest` type (fields the queue uses)
- `src/shared/ipc-contract.ts` — `platform:listPRs` channel

## Commands you will need

| Purpose   | Command           | Expected on success |
|-----------|-------------------|---------------------|
| Full gate | `pnpm check`      | exit 0 (confirms no syntax errors from accidental .ts changes) |

## Scope

**In scope**:
- `docs/specs/review-queue.md` (create)
- `CONTEXT.md` — if a new term needs disambiguation, add it (per CLAUDE.md rules)
- `ROADMAP.md` — tick the `[ ]` Spec item in Phase 5 to `[x]`

**Out of scope**:
- `src/renderer/features/review-queue/ReviewQueue.tsx` — no code changes
- Any behavior change to the queue
- `CHANGELOG.md` — docs-only

## Git workflow

- **Never commit to `main`.** Branch: `docs/review-queue-spec`
- Conventional commit: `docs: add review-queue spec and tick ROADMAP checklist`

## Steps

### Step 1: Read the implementation thoroughly

Before writing a single line, read:
1. `src/renderer/features/review-queue/ReviewQueue.tsx` in full.
2. `ROADMAP.md:220-245` (the Phase 5 queue checklist).
3. `docs/specs/review-workspace.md` (to match spec format).

Note the following behaviors in particular:
- What fields of `PullRequest` the queue renders (title, author, age, state,
  risk dot, summary text, platform).
- How search works (what fields are searched — title, repo, author, summary?).
- Sort modes and their definitions (risk, age, blocking — what is "blocking"?).
- Auto-refresh cadence (60 s per ROADMAP; confirm the value in code).
- Keyboard shortcuts (`j`, `k`, `↑`, `↓`, `/`, `?`, `Esc`, `r`).
- The "no AI key" amber banner behavior.
- Loading / error / empty states.

**Verify**: you can describe each behavior above from what you read, not from
memory of this plan.

### Step 2: Write `docs/specs/review-queue.md`

Structure (match `docs/specs/review-workspace.md` format):

**Header** — title, status, related docs/ADRs, last updated.

**Goal** — one paragraph: what the review queue is for, who uses it, what
job it does. Use `CONTEXT.md` terms.

**Inputs** — what data the queue receives:
- `PullRequest[]` from `platform:listPRs` (both platforms, merged)
- `ReviewResult | null` per PR from `review:getCached` (for risk dot + summary)
- `Settings` (for the AI-key banner)

**Outputs / behavior** — the meat of the spec:
- **List display**: what fields are shown per row (title, platform icon,
  author, age, risk dot, summary excerpt). How does the risk dot map to
  `riskScore`? What does it show when no cached review exists?
- **Sort modes**: define `risk`, `age`, `blocking` precisely. What is the
  tiebreaker when risk scores are equal? What does "blocking" mean — PRs
  assigned to the user for review specifically?
- **Search**: which fields participate in search filtering. Case-sensitive or
  insensitive? What is the empty-query behavior?
- **Auto-refresh**: interval, what happens to the visible list during refresh
  (rows stay visible vs. spinner replaces them).
- **Keyboard navigation**: full table of shortcuts and their actions.
- **Empty state**: what renders when no PRs are returned.
- **Error state**: what renders on a network error.
- **AI-key banner**: when it appears, what it says, when it disappears.

**Out of scope** — what the review queue explicitly does not do (e.g., merge
PRs, show closed PRs, paginate — cite ROADMAP non-goals where relevant).

**Acceptance criteria** — 4–6 bullets a QA reviewer could check manually.

### Step 3: Add `ReviewQueue` to CONTEXT.md if it isn't there

Check `CONTEXT.md` — if `ReviewQueue` does not appear, add an entry:

```markdown
## ReviewQueue

The primary screen of the application. Presents all open pull requests
across all connected platforms in a unified, sorted list. Each row shows
the PR title, author, platform, age, and (when a cached review exists) the
risk score as a colored dot and a one-line summary excerpt. The queue
refreshes automatically every 60 seconds in the background. No platform API
calls are triggered by keyboard navigation — those happen only on PR open.

Distinct from `ReviewWorkspace` — the queue is a list of pending items;
the workspace is where active review of one PR happens.
```

**Verify**: `CONTEXT.md` contains a `ReviewQueue` heading.

### Step 4: Tick the ROADMAP checkbox

In `ROADMAP.md:220`, change:
```
- [ ] Spec: `docs/specs/review-queue.md`
```
to:
```
- [x] Spec: `docs/specs/review-queue.md`
```

### Step 5: Full gate

**Verify**: `pnpm check` → exit 0. (`git status` should show only the four
doc-category files modified — nothing in `src/`.)

## Done criteria

- [ ] `docs/specs/review-queue.md` exists with all sections listed in step 2
- [ ] `CONTEXT.md` has a `ReviewQueue` entry
- [ ] ROADMAP Phase 5 spec checkbox is ticked `[x]`
- [ ] `pnpm check` exits 0
- [ ] No source files modified
- [ ] `plans/README.md` status row updated

## STOP conditions

- The `ReviewQueue.tsx` implementation diverged significantly from what the
  ROADMAP lists (e.g., sort modes or keyboard shortcuts differ) — document
  what the code actually does, not what the roadmap promised, and note the
  discrepancy in the spec's "Notes" section.
- `docs/specs/review-workspace.md` uses a format that differs so much from
  what's described above that matching it would result in a poor spec — use
  the closest reasonable format and note the choice.

## Maintenance notes

- The spec describes current behavior at commit `1278cf3`. When the queue
  changes (new sort mode, new keyboard shortcut), update the spec in the
  same PR as the code change — do not defer. The CLAUDE.md rule about the
  changelog applies equally here: spec updates in the same commit.
- The "blocking" sort mode definition should be clarified with the maintainer
  before publication — if the code's interpretation differs from the intuitive
  one, a doc note is better than speculation.
