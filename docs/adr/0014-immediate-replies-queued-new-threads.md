# ADR-0014: Replies post immediately; new threads go through ReviewDraft

## Status

Accepted — 2026-05-26

## Context

Phase 10 adds two write paths for thread comments:

1. **New threads** — a reviewer posts a comment on a diff line, either
   from a Finding or freeform. These are new conversations that didn't
   exist on the platform before.
2. **Replies** — a reviewer responds to an existing thread that was
   already fetched from the platform.

Both paths could be designed to post immediately or to stage in the
`ReviewDraft` and submit together with the verdict.

## Decision

**New threads are staged as `QueuedComment`s in `ReviewDraft`** and
submitted in a single `platform:submitReview` call alongside the verdict
and body.

**Replies are posted immediately** via `platform:replyToThread` — they
are never staged in the draft.

## Consequences

### Positive

- **Replies feel conversational.** A reviewer can respond "good catch"
  or "can you clarify this?" without having to decide on a verdict first
  or hit a formal submit. This matches how GitHub and ADO themselves work
  — replies and reviews are separate actions on both platforms.
- **New threads stay coherent.** Grouping new inline comments with the
  verdict in one submission makes sense: they are the reviewer's formal
  analysis output and should be delivered together, not piecemeal.
- **No `QueuedReply` type needed.** Staging replies would require a new
  variant in `ReviewDraft`, a UI to display staged replies vs staged new
  threads, and a more complex submit path.

### Negative

- **Asymmetric model.** New threads are deferred; replies are immediate.
  This asymmetry isn't obvious from the code without this ADR.
- **Partial delivery risk.** A reply posts even if the reviewer later
  abandons the review without submitting. Acceptable — replies are
  conversational, not part of the formal verdict.

## Alternatives Considered

### Stage everything in ReviewDraft

All writes (new threads and replies) are queued and submitted together.

Rejected because it makes conversational replies awkward — a reviewer
cannot tell an author "I don't understand this change" mid-review without
also submitting a verdict. It also breaks the mental model of "replying
to someone" vs "writing a review."

### Post everything immediately

New threads post the moment the reviewer clicks confirm on the compose box,
without waiting for review submission.

Rejected because it would post inline comments without a verdict, which
GitHub surfaces as standalone pull request review comments rather than
part of a review. The PR author sees comments appearing one by one before
the review is complete, which is noisy and potentially confusing.
