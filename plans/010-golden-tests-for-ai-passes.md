# Plan 010: Build the golden test suite for AI review passes

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1278cf3..HEAD -- src/main/ai/ src/main/ai/prompts/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (additive — new test files and fixtures only)
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `1278cf3`, 2026-06-12

## Why this matters

The AI review pipeline (correctness, security, consistency, and summary passes)
is the core value-producing part of Vigil. It has no regression protection:
prompt changes, `runReview.ts` changes, or provider-wrapper changes can silently
degrade finding quality with no test failure. ROADMAP Phase 3 listed golden
tests as a checkbox; it was never built. This plan builds them.

The golden tests are intentionally **opt-in** (gated behind
`VIGIL_RUN_GOLDEN_TESTS=1`) to keep `pnpm test` fast and free of network
calls. They exercise the full review pipeline with a real AI provider, snapshot
the finding titles, and fail when the pipeline regresses materially. They are
the CI gate for prompt changes.

## Current state

- `src/main/ai/runReview.ts` — the review engine entry point; accepts
  `ReviewContext`, `CodeAnalyzer[]`, `AIProvider | null`, and `RunReviewOptions`.
  Returns `Promise<Result<ReviewResult, ReviewError>>`.
- `src/main/ai/prompts/` — four prompt files: `correctness.md`, `security.md`,
  `consistency.md`, `summary.md`. These are the files most likely to change and
  most in need of regression protection.
- `src/main/ai/buildReviewContext.ts` — assembles `ReviewContext`. For golden
  tests you construct a `ReviewContext` directly to avoid real network calls to
  GitHub/ADO.
- `src/shared/review.ts` — `Finding`, `ReviewResult` types.
- `src/main/ai/AnthropicProvider.ts` — production AI provider. In golden
  tests you may use this with a real API key, OR substitute a deterministic
  mock that returns controlled JSON to avoid flakiness and cost.
- `src/main/ai/collectStream.test.ts` — pattern example for testing an async
  iterable.
- `src/main/ai/runReview.test.ts` — existing tests mock the AI provider;
  look at them to understand the `ReviewContext` shape.
- The `VIGIL_RUN_GOLDEN_TESTS` env var convention is documented in ROADMAP
  but not implemented — this plan implements it.

## Commands you will need

| Purpose          | Command                                                         | Expected on success |
|------------------|-----------------------------------------------------------------|---------------------|
| Typecheck        | `pnpm typecheck`                                               | exit 0              |
| Golden tests     | `VIGIL_RUN_GOLDEN_TESTS=1 pnpm test src/main/ai/__tests__/golden` | all pass         |
| Normal suite     | `pnpm test`                                                     | 357+ tests (golden skipped) |
| Full gate        | `pnpm check`                                                    | exit 0              |

## Scope

**In scope**:
- `src/main/ai/__tests__/golden/` (create directory)
- `src/main/ai/__tests__/golden/fixtures/` (create directory + fixture files)
- `src/main/ai/__tests__/golden/ai-passes.test.ts` (create)
- `CHANGELOG.md` is **exempt** — tests-only change per CLAUDE.md

**Out of scope**:
- Modifying any prompt in `src/main/ai/prompts/` — this plan tests them as-is.
- Modifying `runReview.ts` or the analyzer implementations.
- Adding a network call to GitHub to fetch fixtures — fixtures are static JSON
  checked into the repo.

## Git workflow

- **Never commit to `main`.** Branch: `test/golden-ai-passes`
- Conventional commit: `test: add golden test suite for AI review passes`

## Steps

### Step 1: Write three fixture ReviewContexts

Create `src/main/ai/__tests__/golden/fixtures/` and add three JSON files.
Each represents a `ReviewContext` as the review engine expects it (read the
`ReviewContext` type in `src/main/ai/CodeAnalyzer.ts`). Use entirely
synthetic code — no real customer code, no real repo names.

**Fixture 1 — `security-bug.json`**: A small TypeScript diff that introduces
an obvious SQL injection (or similar) — e.g., a function that concatenates
user input directly into a query string. The security pass should flag this.

**Fixture 2 — `logic-bug.json`**: A diff that has an off-by-one error or a
reversed condition — e.g., `if (a > b)` where the context makes clear it
should be `if (a < b)`. The correctness pass should flag this.

**Fixture 3 — `clean-trivial.json`**: A trivial, correct diff — e.g., a
rename or adding a comment. The AI passes should produce zero or very-low
severity findings.

Structure of each fixture:
```json
{
  "pr": {
    "ref": { "platform": "github", "owner": "test", "repo": "test", "number": 1 },
    "title": "Test PR",
    "body": "",
    "author": { "login": "alice", "displayName": "Alice" },
    "state": "open",
    "createdAt": "2026-01-01T00:00:00Z",
    "updatedAt": "2026-01-01T00:00:00Z",
    "sourceBranch": "feat/test",
    "targetBranch": "main",
    "webUrl": "https://github.com/test/test/pull/1",
    "headSha": "abc1234"
  },
  "diff": { "files": [/* FileDiff[] */] },
  "files": { "src/example.ts": "/* full file content */" },
  "tokenBudget": 160000
}
```

Read `src/shared/model/index.ts` for the exact required fields of `PullRequest`,
`Diff`, `FileDiff`, `Hunk`, `DiffLine`.

**Verify**: Each JSON file is valid (`node -e "JSON.parse(require('fs').readFileSync('path','utf8'))"`) — exit 0.

### Step 2: Write the golden test harness

Create `src/main/ai/__tests__/golden/ai-passes.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const GOLDEN = process.env["VIGIL_RUN_GOLDEN_TESTS"] === "1";
const skip = GOLDEN ? it : it.skip;

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string) {
  return JSON.parse(
    readFileSync(join(__dirname, "fixtures", name), "utf-8"),
  ) as ReviewContext;   // cast — fixtures are manually authored
}
```

Import `runReview` from `../../../runReview.js` and `AnthropicProvider` from
`../../../AnthropicProvider.js`. Build an `AIProvider` from
`process.env["ANTHROPIC_API_KEY"]` — if the key is absent and `GOLDEN=1`, fail
the test with a descriptive message (not a silent skip).

Tests (all wrapped in `skip()` when `GOLDEN` is false):

1. **Security fixture**: run with `AnthropicProvider` + no static analyzers →
   `ReviewResult.findings` contains at least one finding with `pass: "security"`
   and `severity` of `"high"` or `"critical"`.

2. **Logic-bug fixture**: run → findings contain at least one finding with
   `pass: "correctness"` and `severity` of `"high"` or `"critical"`.

3. **Clean fixture**: run → no findings with `severity === "critical"` or
   `severity === "high"`.

4. **Summary pass**: on the security fixture, `ReviewResult.summary` is a
   non-empty string and `riskScore` is a number 1–5.

Assert findings by properties (pass, severity), NOT by exact title text — that
would make the test brittle to prompt wording changes. Titles and descriptions
are for human review of the snapshot; the test gates on structural properties.

Also write a `findingSnapshot` block that logs `result.value.findings.map(f => ({ title: f.title, severity: f.severity, pass: f.pass }))` — this is not an
assertion, just documentation for the reviewer to read when a golden test runs.

**Verify**: `pnpm test` (without the env var) → all 357+ tests pass, golden
tests show as skipped.

### Step 3: Smoke-run the golden tests

Run `VIGIL_RUN_GOLDEN_TESTS=1 ANTHROPIC_API_KEY=<your-key> pnpm test src/main/ai/__tests__/golden`.

**Verify**: all 4 golden tests pass. Note any findings in the PR description.

If a test fails because the AI returned an unexpected structure:
- For the security fixture: check if the finding was under `pass: "consistency"`
  instead — adjust the assertion to `["security", "correctness"]` if the
  security pass and correctness pass both fire. Document the behavior.
- For the clean fixture: if the AI flags a medium finding, relax the assertion
  to only gate on `critical` (document this as a known false-positive tendency).

### Step 4: Document the golden test workflow

Add a comment block at the top of `ai-passes.test.ts` explaining:
- How to run the golden tests (`VIGIL_RUN_GOLDEN_TESTS=1 ANTHROPIC_API_KEY=…`)
- When to update expectations (when prompts change intentionally)
- What a failure means (AI quality regression; check prompt changes)

**Verify**: `pnpm check` → exit 0 (typecheck + lint + normal test suite).

## Test plan

Four golden tests gate on structural properties of `ReviewResult`, not on
exact text. They run only with `VIGIL_RUN_GOLDEN_TESTS=1` and a real API key,
so they do not run in CI (no secrets in CI). A future step could add them to
the release workflow with a stored secret.

## Done criteria

- [ ] `pnpm test` exits 0 with golden tests skipped (no env var set)
- [ ] `VIGIL_RUN_GOLDEN_TESTS=1 ANTHROPIC_API_KEY=… pnpm test src/main/ai/__tests__/golden` → all 4 pass
- [ ] Three fixture JSON files checked into `fixtures/`
- [ ] `pnpm check` exits 0
- [ ] No production source files modified
- [ ] `plans/README.md` status row updated

## STOP conditions

- The `ReviewContext` type or `runReview` signature changed since `1278cf3` —
  report the diff and update the fixture shape accordingly before writing tests.
- The Anthropic API key is not available in the execution environment — you
  cannot complete step 3. Note that steps 1–2 and 4 are still executable
  (they don't make real API calls) — do those and mark step 3 as requiring
  manual execution.
- Any golden test produces zero findings on the security or logic-bug fixture
  after 3 runs — this suggests a prompt regression or fixture problem; don't
  lower the assertions to make it pass, report it.

## Maintenance notes

- Prompt changes in `src/main/ai/prompts/` MUST be preceded by a golden test
  run to confirm the change doesn't degrade the three fixture results. This is
  now the documented process for prompt iteration.
- Fixtures are synthetic and contain no real code — they do not need to be
  updated unless the `ReviewContext` type changes.
- Adding a fourth fixture (e.g., a large diff that exercises token-budget
  truncation) is the natural follow-up — scope it separately.
