# Spec: PR Comment Thread View

## Goal

Surface existing PR comment threads from the platform inline in the diff
view, and allow the reviewer to post new inline comments (from findings or
freeform) and reply to existing threads — all without leaving Vigil.

This is the read+write thread feature. It extends the Review Workspace
(see `review-workspace.md`) rather than replacing it.

---

## Scope

**In scope:**

- Fetching and displaying existing `Thread`s from GitHub and Azure DevOps
- Posting new inline comments via `QueuedComment` in the `ReviewDraft`
- Freeform inline comments written directly on a diff line
- Immediate replies to existing threads
- Hiding resolved threads by default with a toggle

**Out of scope:**

- Resolving or unresolving threads (managed on the platform directly)
- PR-level (non-line-anchored) comment composition in this phase
- Thread editing or deletion

---

## Model changes

### Thread

New type in `src/shared/model/index.ts`:

```typescript
interface Thread {
  readonly id: string;
  readonly file: string; // file path; PR-level threads omitted in this phase
  readonly line: number; // new-file line number
  readonly comments: readonly Comment[]; // [0] is root, rest are replies
  readonly resolved: boolean;
}
```

### QueuedComment (replaces existing definition)

The existing `QueuedComment` in `review-workspace.md` only handled
findings. This definition supersedes it:

```typescript
type QueuedComment =
  | {
      readonly kind: "from-finding";
      readonly findingTitle: string;
      readonly body: string;
      readonly path: string;
      readonly line: number;
    }
  | {
      readonly kind: "freeform";
      readonly body: string;
      readonly path: string;
      readonly line: number;
    };
```

Both kinds are shown inline in the diff as pending threads before
submission. On `ReviewDraft` submit, both map to
`NewComment { kind: "inline", body, path, line }`.

---

## PR open sequence

On workspace open, three queries now run in parallel:

1. `platform:getPRWithDiff(ref)` — diff (existing)
2. `review:getCached(ref, headSha)` / `review:run(ref)` — findings (existing)
3. `platform:getThreads(ref)` — threads (new)

Threads are fetched once on open. A "Refresh" affordance (keyboard: `R`)
re-fetches threads for reviewers who want to see replies posted since open.

---

## Inline thread display

Line-anchored threads render below their diff line, inline in the diff
view. A thread expands on click or keyboard focus.

### ThreadMarker (gutter)

A chat-bubble icon in the diff gutter on lines that have one or more
threads. Distinct from `FindingMarker` (severity dot) — both can appear
on the same line. If a line has findings **and** threads, both markers
appear side by side.

| State     | Visual                      |
| --------- | --------------------------- |
| 1 thread  | chat icon, `--v-text-faint` |
| N threads | chat icon + count badge     |
| Pending   | chat icon, `--v-accent`     |

### Collapsed state

The diff line renders normally. The ThreadMarker in the gutter indicates
there is a thread. No height added.

### Expanded state

Below the diff line, an inline block renders:

```
┌─────────────────────────────────────────────────────────┐
│ ● wesleytmoura  2h ago                                  │
│ This should use `structuredClone` here — the shallow    │
│ copy will alias nested objects.                         │
│                                                         │
│   ● ada  1h ago                                         │
│   Good catch, will fix.                                 │
│                                                         │
│ [Reply…]                                         [↑]    │
└─────────────────────────────────────────────────────────┘
```

- Root comment + all replies, in chronological order
- Reply input at the bottom (auto-focused when thread expands)
- Submit reply: `↵`; cancel: `Esc` (collapses thread)
- Resolved threads are visually dimmed (greyed out)

### Resolved thread visibility

Resolved threads are hidden by default. A toggle in the diff toolbar
("Show resolved · N") reveals them. The toggle state is per-session,
not persisted.

---

## Pending QueuedComment display

A `QueuedComment` in the draft renders inline at its line position
identically to a platform thread, but with a distinct pending style:

```
┌─────────────────────────────────────────────────────────┐
│ ◌ You  (pending)                       [from-finding ×] │
│ Null pointer dereference: `user` is not checked before  │
│ calling `.name`. Add a null guard here.                 │
└─────────────────────────────────────────────────────────┘
```

- Dashed border or muted accent background to distinguish from posted threads
- `from-finding` badge shows the finding title; `freeform` shows nothing
- `×` removes it from the draft
- Body is editable in-place before submission

---

## Creating a QueuedComment from a Finding

`FindingDetail` in the right panel gains a **"Queue as comment"** button
(keyboard: `a`, existing binding repurposed from "Add to review").

Action:

1. Appends `{ kind: "from-finding", findingTitle: finding.title, body: <formatted finding body>, path: finding.file, line: finding.lines?.start ?? 1 }` to `ReviewDraft.comments`
2. Scrolls the diff to the finding's line and expands the pending thread inline

If the finding has no line (`lines: null`), the button is disabled in
this phase (PR-level comment composition is out of scope).

---

## Creating a freeform QueuedComment

Any diff line has a latent comment affordance. Hovering or focusing a
line reveals a `+` icon in the gutter (right of the line numbers).
Clicking or pressing `i` on the focused line opens an inline compose box
at that position.

Compose box:

- Textarea, auto-focused
- `↵` (with no modifier): newline in body
- `⌘↵`: confirm — appends `{ kind: "freeform", body, path, line }` to draft
- `Esc`: cancel

The compose box renders below the line (same position as an expanded
thread). If there are existing threads on that line, the compose box
appears below them.

---

## Replying to a Thread

Replies are posted immediately — they are **not** staged in the
`ReviewDraft`.

Reply flow:

1. Reviewer expands a thread and types in the reply input
2. Presses `↵` to submit
3. `platform:replyToThread(ref, threadId, body)` is called
4. On success: the new reply is appended to the thread's `comments` array
   in local state (optimistic update); no full re-fetch needed
5. On failure: input is restored with the typed body; error message shown
   inline

---

## IPC changes

### New invoke channels

```typescript
// Fetch all line-anchored threads for a PR.
// Resolved threads are included; the renderer filters them.
"platform:getThreads": (ref: PRRef) => Result<readonly Thread[], PlatformError>;

// Post an immediate reply to an existing thread.
"platform:replyToThread": (
  ref: PRRef,
  threadId: string,
  body: string,
) => Result<Comment, PlatformError>;
```

### Existing channels — no change

- `platform:submitReview` — `NewReview.comments` already carries
  `NewComment[]`; `QueuedComment` maps to `{ kind: "inline", body, path, line }`
- `platform:postComment` — no change; not used in the thread view flow

---

## Platform provider changes

Both `GitHubProvider` and `AzureDevOpsProvider` must implement:

### `getThreads(ref)`

**GitHub:** GitHub's REST API exposes review comments
(`GET /repos/{owner}/{repo}/pulls/{number}/comments`) but does not group
them into threads. Grouping is done client-side: comments with the same
`in_reply_to_id` chain are grouped under their root. Root comments have
no `in_reply_to_id`. Map to `Thread[]` sorted by root comment
`created_at`.

**Azure DevOps:** ADO's Threads API
(`GET /threads?$expand=comments`) returns threads natively. Map
`thread.comments` to `Comment[]`; use `threadContext.rightFileStart.line`
for the line anchor. A thread with no `threadContext` is PR-level and is
filtered out in this phase.

### `replyToThread(ref, threadId, body)`

**GitHub:** `POST /repos/{owner}/{repo}/pulls/{number}/comments` with
`in_reply_to` set to the root comment id (GitHub uses comment IDs, not
thread IDs — store the root comment id as `Thread.id`).

**Azure DevOps:** `POST /threads/{threadId}/comments`.

---

## Keyboard bindings additions

| Key | Action                                                     |
| --- | ---------------------------------------------------------- |
| `i` | Open freeform compose box on the focused diff line         |
| `t` | Expand / collapse the thread on the focused diff line      |
| `R` | Re-fetch threads (capitalised to avoid accidental trigger) |

Existing bindings are unchanged.

---

## Exit criteria

- Opening a PR fetches threads in parallel with the diff; thread markers
  appear in the gutter on lines that have threads
- Expanding a thread shows root comment + replies inline below the line
- Resolved threads are hidden by default; "Show resolved" toggle reveals them
- A finding can be queued as an inline comment; it appears as a pending
  thread at its line position
- A freeform compose box opens on any diff line via `i` or gutter `+`
- Submitting the ReviewDraft posts all QueuedComments as inline comments
  via `platform:submitReview`
- Replying to a thread posts immediately and appends the reply in local state
- Everything above works for both GitHub and Azure DevOps PRs
