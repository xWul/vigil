# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for Vigil.
An ADR captures a single significant architectural decision: the context
that prompted it, the options considered, the choice made, and the
consequences.

## Why ADRs?

Code shows _what_ the system does. ADRs explain _why_ it does it that way.
Six months from now, when someone (including future-me) asks "why is this
an Electron app and not Tauri?" or "why do we have a PlatformProvider
abstraction when we only support GitHub?", the answer is one click away.

## When to write one

Only write an ADR when **all three** of these are true:

1. **Hard to reverse.** The cost of changing your mind later is
   meaningful — refactoring multiple modules, breaking persisted
   data, etc.
2. **Surprising without context.** A future reader will reasonably
   ask "why did they do it this way?" The answer isn't obvious from
   the code alone.
3. **The result of a real trade-off.** There were genuine
   alternatives and you picked one for specific reasons.

If any of the three is missing, skip the ADR. Use a comment in the
code, a note in `ARCHITECTURE.md`, or a line in a spec instead.

This criteria is stricter than "document every decision" deliberately.
We want every ADR in this directory to be worth reading six months
from now.

## Format

Each ADR is a short markdown file with this structure:

- **Status** — Proposed, Accepted, Superseded, or Deprecated
- **Context** — what situation required a decision
- **Decision** — what we chose
- **Consequences** — what follows from this decision, good and bad
- **Alternatives Considered** — what we didn't pick, and why
- **References** — relevant external links and internal docs

Keep them short. If an ADR is longer than two pages, it probably
contains material that belongs in a spec under `docs/specs/` instead.

## Naming

`NNNN-short-kebab-case-title.md`, numbered sequentially starting from 0001.
Numbers are never reused, even if an ADR is superseded.

## Lifecycle

- Write the ADR _before_ implementing the decision when feasible.
- Once accepted, ADRs are immutable except for status changes.
- If a decision is reversed, write a new ADR that supersedes the old one
  and update the old one's status to "Superseded by ADR-NNNN".

## Tooling

The [`grill-with-docs`](../../.claude/skills/grill-with-docs/) skill
in this repo helps decide whether a decision deserves an ADR and helps
draft it. It applies the three-rule criteria above strictly.

## Index

| #                                                | Title                                               | Status   |
| ------------------------------------------------ | --------------------------------------------------- | -------- |
| [0001](./0001-electron-over-tauri.md)            | Electron over Tauri for the desktop shell           | Accepted |
| [0002](./0002-platform-provider-abstraction.md)  | PlatformProvider Abstraction                        | Accepted |
| [0003](./0003-pkce-for-desktop-oauth.md)         | PKCE Authorization Code Flow for Azure DevOps OAuth | Accepted |
| [0004](./0004-keychain-for-token-storage.md)     | OS Keychain for Token Storage                       | Accepted |
| [0005](./0005-result-type-for-error-handling.md) | Result Type for Expected Failure Modes              | Accepted |
| [0006](./0006-local-structured-logging.md)       | Local Structured Logging with electron-log          | Accepted |
| [0007](./0007-hybrid-review-pipeline.md)         | Hybrid Review Pipeline — Static Analysis + AI       | Accepted |
| [0008](./0008-ai-provider-streaming-interface.md)| AIProvider Streaming via AsyncIterable              | Accepted |

<!-- Append new ADRs to this table as they are written. -->
