# Spec: Review Workspace

## Goal

The Review Workspace is the screen a reviewer sees after selecting a PR
from the Review Queue. It is the primary value surface of Vigil: a diff
viewer with AI findings overlaid, keyboard-first navigation, and a
one-click path from finding to submitted review comment.

The workspace is fully functional without AI — static analysis findings,
the diff view, and review actions all work with no API key configured.
AI is an enhancement, not a requirement.

---

## Entry point

Pressing `Enter` on a selected row in the Review Queue opens the workspace.
The app route becomes:

```typescript
{
  screen: "workspace";
  pr: PullRequest;
  ref: PRRef;
}
```

On open, the workspace immediately:

1. Calls `platform:getPRWithDiff(ref)` to fetch the diff. This is fast
   (network-only, no AI) and the diff renders as soon as it arrives.
2. Calls `review:getCached(ref, pr.headSha)`. On a cache hit, findings
   render immediately and a "Re-run" button is available. On a miss,
   `review:run(ref)` starts automatically and findings stream in.

`Esc` returns to the Review Queue.

---

## Layout

Two-column, fixed height (fills the window):

```
┌──────────────────────────────┬──────────────────────────┐
│  Titlebar (drag + back btn)  │                          │
├──────────────────────────────┤   Right panel            │
│                              │                          │
│   Diff view (~65% width)     │   (finding detail        │
│                              │    or idle state)        │
│                              │                          │
├──────────────────────────────┤                          │
│   Pass progress strip        │   Review actions         │
└──────────────────────────────┴──────────────────────────┘
```

### Diff view (left column)

- Unified diff, syntax-highlighted
- Files listed sequentially; each file has a collapsible header
- Hunks within a file are individually collapsible
- Line gutter shows old/new line numbers and FindingMarkers
- Horizontally scrollable per-file if lines are long

### Pass progress strip (below diff)

A slim strip between the diff and the window bottom. Shows each
`FindingPass` as a pill:

- `⟳ running` — pass is in progress (`review:pass status: "start"`)
- `✓ N` — pass complete with N findings (`review:pass status: "complete"`)

Disappears once all passes complete and collapses to zero height.

### Right panel (~35% width)

Three states:

**Idle** (no finding focused): shows PR-level findings (those with
`lines: null`) pinned at the top — one card per PR-level finding.
Below them, the ReviewDraft composer (see Review Actions).

**Finding focused**: shows the focused FindingDetail at the top of the
panel. Below it: the ChallengeThread for that finding (if AI is
configured) or a prompt to configure AI. Below the thread: the
ReviewDraft composer.

**Review submitted**: shows a confirmation state with a link to the
PR on the platform.

---

## FindingMarker

A small severity-colored dot rendered in the diff gutter on each line
that falls within a finding's `lines` range. Severity colors match the
existing risk palette:

| Severity        | Color token |
| --------------- | ----------- |
| critical / high | `--v-red`   |
| medium          | `--v-amber` |
| low / info      | `--v-green` |

When multiple findings overlap on the same lines, a single dot with a
count badge (`2`, `3+`) is shown — clicking or navigating to it cycles
through the overlapping findings.

Findings with `lines: null` have no gutter marker — they appear only in
the right panel's idle state as pinned PR-level cards.

Removed lines (`DiffLine.kind === "removed"`, `newLine === null`) never
carry markers — findings always attach to new-file line numbers.

---

## FindingDetail

Shown in the right panel when a finding is focused. Contains:

- Severity badge + pass label (e.g. "HIGH · regression")
- Title (one line, bold)
- Description (2–4 sentences)
- Evidence block: a diff-style code snippet (monospace, syntax-dimmed)
- "Add to review" button — queues the finding as an inline comment in
  the ReviewDraft
- "Challenge this" button — opens the ChallengeThread (hidden if no AI
  is configured; replaced by "Configure AI in Settings")

---

## ChallengeThread

A per-finding AI conversation scoped to the focused finding. Lives below
FindingDetail in the right panel.

The AI receives:

- The finding (severity, title, description, evidence)
- The user's message
- The relevant diff hunk (for context)

The AI does **not** receive the full diff or file contents — keeping
context small makes responses fast and cheap.

Responses stream via the existing `AIProvider` stream interface. A new
IPC channel handles this:

```typescript
"review:challenge": (
  ref: PRRef,
  finding: Finding,
  hunkContext: string,   // the raw diff lines of the relevant hunk
  messages: readonly { role: "user" | "assistant"; content: string }[],
) => Result<void, ReviewError>
```

The response streams back via a new push event:

```typescript
"review:challengeChunk": {
  readonly token: string;
  readonly done: boolean;
}
```

The thread stores message history locally in component state — it is not
persisted across sessions.

---

## ReviewDraft

The in-progress review being composed before submission. Maintained in
workspace component state. Contains:

- `verdict: "approved" | "changes_requested" | "commented" | null`
- `body: string` — overall review comment
- `comments: QueuedComment[]` — findings the reviewer has chosen to post

```typescript
interface QueuedComment {
  readonly finding: Finding;
  readonly body: string; // pre-formatted from finding; editable
}
```

"Add to review" on a FindingDetail appends to `comments`. Each queued
comment shows in the ReviewDraft section with a remove button.

On submit, the workspace calls `platform:submitReview(ref, {
  verdict: draft.verdict ?? "commented",
  body: draft.body,
  comments: draft.comments.map(c => ({
    kind: "inline",
    body: c.body,
    path: c.finding.file,
    line: c.finding.lines?.start ?? 1,
  }))
})`.

PR-level findings (no `lines`) are submitted as `{ kind: "pr_comment" }`.

---

## Fallback risk score (static-only mode)

When no AI is configured, `ReviewResult.riskScore` is `null`. The
workspace derives a display score mechanically:

| Condition              | Fallback score |
| ---------------------- | -------------- |
| Any `critical` finding | 5              |
| Any `high` finding     | 4              |
| Any `medium` finding   | 3              |
| `low` / `info` only    | 2              |
| Zero findings          | 1              |

This score is display-only — it is never written back to `ReviewResult`.

---

## Keyboard bindings

| Key     | Action                                                  |
| ------- | ------------------------------------------------------- |
| `j / k` | Next / previous finding (scrolls diff to relevant hunk) |
| `] / [` | Next / previous hunk (raw diff navigation)              |
| `a`     | Add focused finding to ReviewDraft                      |
| `c`     | Open / focus ChallengeThread for focused finding        |
| `Esc`   | Back to Review Queue                                    |
| `?`     | Toggle help overlay                                     |
| `⌘↵`    | Submit ReviewDraft                                      |

`j/k` are active from the moment the workspace opens — no mode switch needed.

---

## IPC changes required

### New invoke channel

```typescript
"review:challenge": (
  ref: PRRef,
  finding: Finding,
  hunkContext: string,
  messages: readonly { role: "user" | "assistant"; content: string }[],
) => Result<void, ReviewError>
```

### New push event

```typescript
"review:challengeChunk": {
  readonly token: string;
  readonly done: boolean;
}
```

### Existing channels used

- `platform:getPRWithDiff` — fetch diff on open
- `review:getCached` — check for cached result
- `review:run` — trigger review if no cache
- `review:finding` (push) — stream findings as they arrive
- `review:pass` (push) — update pass progress strip
- `platform:submitReview` — submit ReviewDraft

---

## Exit criteria

- Selecting a PR in the queue opens the workspace and renders the diff
- Static findings appear in the gutter with severity-colored dots
- Navigating with `j/k` scrolls the diff and updates the right panel
- The pass progress strip updates as each pass completes
- "Add to review" queues a finding as a comment
- Submitting the review posts to the platform and shows confirmation
- Everything above works with no AI provider configured
- With AI configured, findings stream in and "Challenge this" is available
