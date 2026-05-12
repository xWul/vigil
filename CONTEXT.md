# Domain Glossary — Vigil

Terms that are meaningful at the domain level and need precise definitions
to prevent sloppy language producing sloppy code. Implementation details
do not belong here.

---

## AuthSession

The result of a successful sign-in. Contains everything needed to make
authenticated API calls on the user's behalf and to refresh those
credentials when they expire.

For Azure DevOps:

- access token (short-lived)
- refresh token (long-lived)
- expiry timestamp
- user display name (from Entra ID)
- user principal name / UPN (e.g. `user@company.com`)

For Azure DevOps:

- access token (short-lived)
- refresh token (long-lived)
- expiry timestamp
- user display name (from Entra ID)
- user principal name / UPN (e.g. `user@company.com`)

For GitHub:

- access token (does not expire — GitHub OAuth App tokens have no expiry)
- display name (GitHub `name`; falls back to `login` if unset)
- login (GitHub username, e.g. `ada`)

No refresh token or expiry timestamp for GitHub. If a GitHub token is
revoked, the caller receives a 401 from the platform API and must
trigger a new `signIn()`.

An `AuthSession` is **identity-scoped, not org-scoped**. One account
can belong to many organizations; org membership is discovered separately
(Phase 2). An `AuthSession` answers "who are you?" not "which org are
you in?"

`AuthSession` values are persisted to the OS keychain via `TokenStore`
and never exposed to the renderer process.

---

## Account

The user's identity on a given platform. For Azure DevOps, this is the
user's Microsoft/Entra ID identity (identified by UPN). For GitHub, it
is the GitHub account (identified by login/username).

An Account is distinct from an Organization. An Account can be a member
of many Organizations.

---

## Organization (Azure DevOps)

The top-level grouping in Azure DevOps, accessed at
`https://dev.azure.com/{org}`. A single Microsoft Account can be a
member of multiple Organizations. Organization membership discovery
is out of scope for Phase 1 (auth); it is handled by the
`AzureDevOpsProvider` in Phase 2.

---

## AuthError

The typed failure union returned by `AuthProvider` operations. Six variants:

- `cancelled` — user closed the browser without completing the flow (not a user-facing error; dismiss silently)
- `timeout` — the OAuth callback or Device Flow code expired before the user completed sign-in
- `network` — could not reach the platform's auth endpoint (transient)
- `consent_denied` — user declined the permission prompt
- `refresh_expired` — the long-lived credential is no longer valid; user must sign in again (Azure DevOps only — GitHub tokens do not expire)
- `auth_failed` — catch-all for provider errors, carries a `message` string

---

## PRRef

A handle that uniquely identifies a pull request. Carries the routing
information needed to call the correct platform API. Discriminated union:

- GitHub: `{ platform: "github", owner, repo, number }`
- Azure DevOps: `{ platform: "azure-devops", org, project, repo, id }`

`PRRef` is produced by `parsePRUrl` from a browser URL and consumed by
`PlatformProvider` methods. The discriminated union makes passing a GitHub
ref to the Azure DevOps provider a compile-time error.

---

## PullRequest

The normalized internal representation of a pull request. Contains
metadata (title, author, state, timestamps, branches, web URL) but
**not** the diff — the diff is fetched separately via
`PlatformProvider.getDiff`. Both `listOpenPullRequests` and
`getPullRequest` return this type.

`state` is always `"open"` or `"draft"` — closed and merged PRs are
filtered server-side and never appear in the queue.

---

## Diff

The structured, normalized representation of all file changes in a PR.
`Diff` → `FileDiff[]` → `Hunk[]` → `DiffLine[]`. Each `DiffLine`
carries `oldLine` and `newLine` numbers (null for added/removed lines
respectively) and a `kind` of `"context"`, `"added"`, or `"removed"`.

There is no raw unified-diff string — providers parse the platform
response into this structure. The AI pipeline and diff viewer both
consume the structured form.

---

## PlatformError

The typed failure union returned by `PlatformProvider` operations:

- `not_found` — the PR, repo, or project does not exist
- `forbidden` — the authenticated user lacks permission
- `rate_limited` — the platform is throttling requests; carries optional `retryAfterMs`
- `network` — could not reach the platform API (transient)
- `platform_error` — catch-all for unexpected API errors, carries a `message` string

HTTP 401 is **not** a `PlatformError`. Token expiry is handled by
`withRefreshRetry` before it reaches any `PlatformProvider` caller.

---

## ReviewVerdict

The decision the reviewer submits on a PR: `"approved"`,
`"changes_requested"`, or `"commented"` (a general comment with no
approval decision). Submitted via `PlatformProvider.submitReview`.

---

## Finding

The atomic unit of review output. Produced by either a `CodeAnalyzer`
(static analysis) or an AI review pass. Fields:

- `severity` — `"critical" | "high" | "medium" | "low" | "info"`
- `title` — one-line summary of the issue
- `description` — 2–4 sentences explaining the issue
- `evidence` — the exact code snippet or diff lines that triggered this finding
- `file` — file path where the finding applies
- `lines` — `{ start, end }` line range, or `null` for PR-level findings
- `pass` — which pass produced it: `"correctness" | "security" | "consistency"` (AI passes) or `"complexity" | "duplication" | "smells"` (static analysis)
- `source` — `"static"` or `"ai"`, distinguishing the analysis lane

A `Finding` is always scoped to a single file (or the PR as a whole). It never spans multiple files.

---

## ReviewResult

The aggregated output of a full review pipeline run. Contains:

- `findings` — all `Finding[]` from both static analysis and AI passes combined
- `summary` — a 3–5 sentence synthesis produced by the summary AI pass, receiving only the prior findings (not the diff or file content)
- `riskScore` — `1 | 2 | 3 | 4 | 5` assigned by the summary pass as a holistic judgment (1 = trivial, 5 = do not merge); not computed mechanically from finding counts

AI is optional — if no `AIProvider` is configured, `ReviewResult` still contains static analysis findings, an empty summary, and no risk score.

---

## ReviewContext

The input assembled once by the context builder and consumed by all review passes (both `CodeAnalyzer` and the AI review engine). Contains:

- `pr` — the `PullRequest` metadata
- `diff` — the full structured `Diff`
- `files` — a map of `path → file content at HEAD` for changed files that fit within the token budget; deleted files have no entry
- `tokenBudget` — the maximum token count for this review run

The `AuthSession` is not included — the context builder fetches file contents before constructing `ReviewContext`, so credentials never leak into the review pipeline.

---

## CodeAnalyzer

A local analysis pass that produces `Finding[]` from code structure alone — no LLM involved. Each `CodeAnalyzer` has an `id` and receives a `ReviewContext`. Implementations in Phase 3:

- `ComplexityAnalyzer` — cyclomatic complexity per function; flags functions above threshold
- `DuplicationAnalyzer` — detects copy-pasted blocks across changed files using line hashing
- `SmellsAnalyzer` — structural smells: long functions, long parameter lists, deep nesting

All analyzers only examine files that appear in the diff. Non-TypeScript/JavaScript files produce no findings. `CodeAnalyzer` failures are silent — a failed analyzer logs a warning and returns empty findings; it never blocks the review.

---

## AIProvider

The abstraction over LLM providers. Receives an `AIRequest` (system prompt, messages, model, maxTokens) and returns an `AsyncIterable<string>` of token chunks. Callers that need the full response use a `collectStream` helper.

Model selection is the caller's responsibility — the model name is passed in `AIRequest.model`. `AIProvider` does not know about keychain or BYOK storage; it receives its API key at construction time.

Implementations: `AnthropicProvider` (`@anthropic-ai/sdk`) and `OpenAIProvider` (`openai` package).

---
