# Spec: Extended Static Analyzers

## Goal

Add three new `CodeAnalyzer` implementations to the static analysis lane.
All three produce `Finding[]` and integrate with the existing `runReview`
pipeline without requiring an `AIProvider`.

The existing analyzers (`ComplexityAnalyzer`, `DuplicationAnalyzer`,
`SmellsAnalyzer`) all work on **full file content at HEAD** — they assess
the current state of each changed file. The new analyzers take a different
approach: two of them work on the **diff itself** (added lines only), and
one classifies the entire PR by scanning both added and removed lines.
This makes them diff-aware: they flag what the PR *introduced*, not
pre-existing debt.

---

## New `FindingPass` values

Three new values are added to the `FindingPass` union:

- `"debug-artifacts"` — produced by `DebugArtifactsAnalyzer`
- `"type-safety"` — produced by `TypeSafetyAnalyzer`
- `"change-classification"` — produced by `ChangeClassifierAnalyzer`

These are added to `CodeAnalyzer.id` as well.

---

## DebugArtifactsAnalyzer

### What it does

Scans **added lines only** across all changed files for patterns that
should not appear in a submitted PR: debug output statements, hard
breakpoints, and unresolved debt markers.

By scanning only added lines, it avoids re-flagging pre-existing artifacts
in unchanged code. A PR that *removes* a `console.log` produces no findings.

### Patterns

| Pattern | Match (case-sensitive) | Severity |
|---|---|---|
| Console output | `console.log`, `console.error`, `console.warn`, `console.debug`, `console.info` | `low` |
| Hard breakpoint | `debugger` | `medium` |
| Debt markers | `TODO`, `FIXME`, `HACK`, `XXX` (with or without trailing `:`) | `info` |

Console methods are flagged because the correct approach in Vigil is the
injected `Logger` interface, not direct `console.*` calls. `debugger` is
`medium` because it causes a hard stop in any environment with DevTools open.
Debt markers are `info` — they are intentional; surfacing them for
visibility is the goal, not demanding removal.

### File scope

All files in the diff. No extension filtering. `TODO`/`FIXME` markers
appear in any language; `console.*` and `debugger` are JavaScript/TypeScript
only but produce no false positives in other file types.

### Finding shape

One finding per matched line.

- `file`: `FileDiff.newPath`
- `lines`: `{ start: DiffLine.newLine, end: DiffLine.newLine }` — single line
- `evidence`: the full content of the matching line (trimmed)
- `pass`: `"debug-artifacts"`
- `source`: `"static"`

---

## TypeSafetyAnalyzer

### What it does

Scans **added lines only** across all changed files for TypeScript
type-safety regressions — patterns that weaken or suppress the type system.

By scanning only added lines, it flags what the PR author introduced, not
pre-existing unsafe code.

### Patterns

| Pattern | Match | Severity |
|---|---|---|
| Type erasure | `as any` | `medium` |
| Double-cast escape | `as unknown as` | `medium` |
| Error suppression | `@ts-ignore` | `medium` |
| Expected error (tests) | `@ts-expect-error` | `info` |
| Non-null assertion | `!.` or `!` immediately before `;`, `,`, `)`, or `]` | `low` |

`as X` casts in general (e.g. `as "POST"`, `as ReadonlyArray<string>`) are
**not** flagged — they are often legitimate type narrowings. Only `as any`
and double-cast patterns are flagged. `: any` type annotations (parameter
and return types) are also not flagged — the AI security pass covers
deeper type-safety issues with context the analyzer lacks.

`@ts-expect-error` is `info` because it has legitimate uses in test files.
The finding makes it visible to the reviewer without demanding removal.

Non-null assertion matching uses end-of-expression boundaries to avoid
false positives from logical NOT (`!condition`).

### File scope

All files in the diff. Non-TypeScript files will match no patterns.

### Finding shape

One finding per matched line.

- `file`: `FileDiff.newPath`
- `lines`: `{ start: DiffLine.newLine, end: DiffLine.newLine }`
- `evidence`: the full content of the matching line (trimmed)
- `pass`: `"type-safety"`
- `source`: `"static"`

---

## ChangeClassifierAnalyzer

### What it does

Classifies each changed file as one of four categories and emits a PR-level
summary finding. Optionally emits an intent-mismatch finding when the PR
title signals a pure refactor but the diff contains behavior-changing code.

This is a **heuristic** classifier. It uses control-flow keyword presence
in added and removed lines as a proxy for behavior change. It cannot
distinguish a renamed identifier from a changed logic path without comparing
ASTs — a rename that touches a line containing `return` will be
misclassified as a behavior change. The findings are labelled accordingly.
A true AST-level semantic diff is a future improvement (requires `baseSha`
on `PullRequest` and fetching base file content).

### File classification

Rules applied per file, in priority order:

| Label | Condition |
|---|---|
| `"test"` | `newPath` matches `*.test.ts`, `*.spec.ts`, `*.test.tsx`, `*.spec.tsx`, `*.test.js`, `*.spec.js` |
| `"config"` | `newPath` matches `*.json`, `*.yaml`, `*.yml`, `*.md`, `*.env`, `*.env.*` |
| `"behavior"` | Any added or removed line (not context) contains a control-flow keyword |
| `"refactor"` | All other files with changes |

Control-flow keywords: `if`, `else`, `while`, `for`, `switch`, `case`,
`try`, `catch`, `throw`, `return`, `break`, `continue`, `yield`, `await`.

Word-boundary matching (e.g. `\breturn\b`) prevents substring matches
inside identifiers like `returnValue`.

**Deleted files** are classified by path rules only (no hunk scanning):
a deleted `*.test.ts` is `"test"`, a deleted `*.json` is `"config"`,
anything else is `"behavior"`.

**Renamed files** with no hunks (pure rename, no content change) have no
added or removed lines — no control-flow keywords found — classified as
`"refactor"`. Renamed files with content changes apply the normal heuristic.

### Output findings

#### 1. Change summary (always emitted)

A PR-level overview of the classification breakdown.

- `severity`: `"info"`
- `file`: `""` (PR-level, not file-scoped)
- `lines`: `null`
- `title`: `"Change breakdown: {N} behavior, {M} refactor-only, {P} test, {Q} config"`
- `description`: Lists the file paths of behavior-change files specifically.
  For refactor/test/config files, counts only.
  Example: *"Behavior files: src/main/auth/withRefreshRetry.ts,
  src/main/platforms/GitHubProvider.ts. Refactor-only: 4 files.
  Test: 2 files. Config: 1 file. Note: classification is heuristic —
  rename-heavy PRs may show false behavior positives."*
- `evidence`: `""`
- `pass`: `"change-classification"`
- `source`: `"static"`

#### 2. Intent mismatch (conditional)

Emitted only when **both** conditions are true:
1. `pr.title` contains any of: `refactor`, `rename`, `cleanup`, `clean up`,
   `tidy`, `chore` (case-insensitive, word-boundary match)
2. At least one file is classified as `"behavior"`

- `severity`: `"medium"`
- `file`: `""` (PR-level)
- `lines`: `null`
- `title`: `"Intent mismatch: PR describes a refactor but contains behavior changes"`
- `description`: Lists the behavior-change files. Includes the heuristic caveat.
- `evidence`: The PR title that triggered the keyword match.
- `pass`: `"change-classification"`
- `source`: `"static"`

---

## Relationship to existing analyzers

The three existing analyzers (`ComplexityAnalyzer`, `DuplicationAnalyzer`,
`SmellsAnalyzer`) analyze the state of the code at HEAD. The three new
analyzers analyze the **change** itself. They are complementary: the former
catch structural problems in the post-merge state; the latter catch problems
the PR introduced or flag how the PR should be reviewed.

All six analyzers run unconditionally (no API key required) and their
findings are included in `ReviewResult.findings` alongside any AI findings.

---

## Exit criteria

- `pnpm test` passes with new analyzer unit tests covering: happy path
  (no findings on clean diff), detection (correct finding on matching
  diff line), and edge cases (deleted files classified by type, renamed
  files with no hunks classified as refactor, empty diff).
- Running `pnpm review <pr-url>` on a PR that contains a `console.log`
  addition produces a `"debug-artifacts"` finding pointing to the exact line.
- Running `pnpm review <pr-url>` on a PR titled "refactor: ..." that
  contains an `if` change produces both a change summary and an intent
  mismatch finding.
