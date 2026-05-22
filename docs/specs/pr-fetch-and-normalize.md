# Spec: PR Fetch and Normalize

**Phase:** 2
**Status:** Ready for implementation
**Related:** ADR-0002 (PlatformProvider abstraction), ADR-0003 (PKCE OAuth), ADR-0005 (Result type), `CONTEXT.md` (PRRef, PullRequest, Diff, PlatformError), `docs/specs/auth-azure-devops.md`, `docs/specs/auth-github.md`

---

## Goal

Given an authenticated session, fetch a pull request from GitHub or Azure
DevOps and normalize it into a shared internal model. The rest of the
application never deals with platform-specific API shapes.

This spec covers `PlatformProvider` and its two implementations, the URL
parser for PR refs, and the internal model types. Authentication is out of
scope (Phase 1). The AI review pipeline is out of scope (Phase 3).

---

## Internal model types

All types are defined in `src/main/platforms/model/`.

### `PRRef`

A handle that uniquely identifies a pull request and carries the routing
information needed to call the right platform API.

```ts
type PRRef =
  | {
      readonly platform: "github";
      readonly owner: string; // e.g. "acmecorp"
      readonly repo: string; // e.g. "backend"
      readonly number: number; // e.g. 42
    }
  | {
      readonly platform: "azure-devops";
      readonly org: string; // e.g. "acmecorp"
      readonly project: string; // e.g. "backend"
      readonly repo: string; // e.g. "api"
      readonly id: number; // PR id, e.g. 1337
    };
```

`PRRef` is the discriminated union and is the primary currency passed
between the URL parser, `PlatformProvider`, and the IPC layer.

### `Author`

```ts
interface Author {
  readonly displayName: string;
  readonly login: string; // GitHub username or ADO uniqueName
}
```

### `PullRequest`

Metadata about a PR. Does **not** include the diff — use `getDiff` for
that. Returned by both `listOpenPullRequests` and `getPullRequest`.

```ts
interface PullRequest {
  readonly ref: PRRef;
  readonly title: string;
  readonly body: string; // PR description; may be empty string
  readonly author: Author;
  readonly state: "open" | "draft";
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly url: string; // canonical web URL
  readonly targetBranch: string; // base branch, e.g. "main"
  readonly sourceBranch: string; // head branch
}
```

`state` only has two values because closed and merged PRs are never
included in the review queue. Providers filter them server-side.

### `Diff`

Structured representation of all file changes in a PR. There is no raw
unified-diff string — providers parse the platform response into this
structure. The AI pipeline and diff viewer both consume the structured form.

```ts
interface Diff {
  readonly files: readonly FileDiff[];
}

interface FileDiff {
  readonly status: "added" | "modified" | "deleted" | "renamed";
  readonly oldPath: string | null; // null for added files
  readonly newPath: string; // always present
  readonly hunks: readonly Hunk[];
}

interface Hunk {
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  readonly lines: readonly DiffLine[];
}

interface DiffLine {
  readonly kind: "context" | "added" | "removed";
  readonly content: string; // line text without leading +/-/
  readonly oldLine: number | null; // null for added lines
  readonly newLine: number | null; // null for removed lines
}
```

### `Comment` and write types

```ts
interface Comment {
  readonly id: string;
  readonly body: string;
  readonly author: Author;
  readonly createdAt: Date;
}

type NewComment = { readonly kind: "inline"; readonly body: string; readonly path: string; readonly line: number } | { readonly kind: "pr_comment"; readonly body: string };

type ReviewVerdict = "approved" | "changes_requested" | "commented";

interface NewReview {
  readonly verdict: ReviewVerdict;
  readonly body: string;
  readonly comments: readonly NewComment[];
}
```

`inline` comments reference `DiffLine.newLine`. Each provider translates
this to whatever position scheme its API expects.

`NewReview` bundles inline comments with the verdict so the provider can
submit them atomically in one API call.

### `PlatformError`

```ts
type PlatformError = { readonly code: "not_found" } | { readonly code: "forbidden" } | { readonly code: "rate_limited"; readonly retryAfterMs?: number } | { readonly code: "network"; readonly cause?: string } | { readonly code: "platform_error"; readonly message: string };
```

`401 Unauthorized` is **not** a `PlatformError`. It is handled by
`withRefreshRetry` before it reaches the caller. The provider receives a
fresh session from `withRefreshRetry` and retries once; if the second
attempt also returns 401, `withRefreshRetry` surfaces an `AuthError`
(not a `PlatformError`).

GitHub returns 403 for both permission errors and rate limits. Providers
must inspect `X-RateLimit-Remaining: 0` to distinguish `rate_limited`
from `forbidden`.

---

## `PlatformProvider` interface

Defined in `src/main/platforms/PlatformProvider.ts`.

```ts
interface PlatformProvider {
  readonly id: "github" | "azure-devops";

  listOpenPullRequests(session: AuthSession): Promise<Result<readonly PullRequest[], PlatformError>>;

  getPullRequest(session: AuthSession, ref: PRRef): Promise<Result<PullRequest, PlatformError>>;

  getDiff(session: AuthSession, ref: PRRef): Promise<Result<Diff, PlatformError>>;

  postComment(session: AuthSession, ref: PRRef, comment: NewComment): Promise<Result<Comment, PlatformError>>;

  submitReview(session: AuthSession, ref: PRRef, review: NewReview): Promise<Result<void, PlatformError>>;
}
```

Session is passed per-call (not injected at construction) so the provider
is stateless with respect to credentials. See ADR-0002.

`listOpenPullRequests` returns PRs where the authenticated user is a
requested reviewer — it is an assignment-based queue, not a repo browser.

---

## `GitHubProvider`

Defined in `src/main/platforms/GitHubProvider.ts`.

**Transport:** `@octokit/rest`. Octokit handles `fetch` under the hood, so
MSW can intercept it in tests.

**Authentication:** pass `auth: session.accessToken` to the Octokit
constructor on each call. Do not cache the Octokit instance across calls —
the session (and therefore the token) may change between calls if
`withRefreshRetry` refreshes it.

**`listOpenPullRequests`:** calls
`GET /search/issues?q=is:open+is:pr+review-requested:@me&per_page=100`.
Maps each result to `PullRequest` using `parsePRUrl` to build the `PRRef`.

**`getPullRequest`:** calls `GET /repos/{owner}/{repo}/pulls/{pull_number}`.

**`getDiff`:** calls `GET /repos/{owner}/{repo}/pulls/{pull_number}/files`
(returns per-file patches). Parse each patch string using a diff-parsing
library (see Dependencies below) into `FileDiff` / `Hunk` / `DiffLine`.

**`postComment`:**

- `kind: "pr_comment"` → `POST /repos/{owner}/{repo}/issues/{issue_number}/comments`
- `kind: "inline"` → `POST /repos/{owner}/{repo}/pulls/{pull_number}/comments`
  (requires converting `newLine` to a GitHub position offset)

**`submitReview`:** `POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews`

**Rate limiting:** GitHub returns `X-RateLimit-Reset` as a Unix timestamp.
Convert to `retryAfterMs = (resetTimestamp - now) * 1000`.

---

## `AzureDevOpsProvider`

Defined in `src/main/platforms/AzureDevOpsProvider.ts`.

**Transport:** raw `fetch`. The Azure DevOps SDK fights our `AuthSession`
model; raw fetch is consistent with the existing auth providers.

**Construction:** takes `org: string` as a constructor parameter. Org
discovery (`/_apis/accounts`) is a separate utility function
(`discoverOrgs(session)`) called before construction — the provider itself
never performs discovery.

```ts
class AzureDevOpsProvider implements PlatformProvider {
  constructor(
    private readonly org: string,
    private readonly logger: Logger = new NoopLogger(),
  ) {}
}
```

**Base URL:** `https://dev.azure.com/{org}`

**`listOpenPullRequests`:** calls
`GET {base}/_apis/git/pullrequests?reviewerID={userId}&status=active&api-version=7.1`
across all projects in the org. The `userId` is the GUID from
`GET https://app.vssps.visualstudio.com/_apis/profile/profiles/me`.

**`getPullRequest`:** `GET {base}/{project}/_apis/git/repositories/{repo}/pullrequests/{id}?api-version=7.1`

**`getDiff`:** Fetches the PR's iterations and their changes:
`GET {base}/{project}/_apis/git/repositories/{repo}/pullrequests/{id}/iterations?api-version=7.1`
then `GET .../iterations/{latest}/changes`. Azure DevOps returns per-file
change metadata; the actual diff content is fetched per-file via the Items
API with `?versionDescriptor.version={sourceBranch}` vs
`?versionDescriptor.version={targetBranch}`. Parse into `FileDiff[]`.

**`postComment`:** `POST {base}/{project}/_apis/git/repositories/{repo}/pullrequests/{id}/threads?api-version=7.1`

**`submitReview`:** `POST {base}/{project}/_apis/git/repositories/{repo}/pullrequests/{id}/reviewers/{userId}?api-version=7.1`
with `vote` field: `10` = approved, `-10` = rejected, `0` = no vote.

**Authentication:** `Authorization: Bearer {session.accessToken}` header on
every request.

---

## `discoverOrgs`

A standalone async function (not a method on `AzureDevOpsProvider`):

```ts
function discoverOrgs(session: AuthSession): Promise<Result<string[], PlatformError>>;
```

Calls `GET https://app.vssps.visualstudio.com/_apis/accounts?memberId={userId}&api-version=7.1`.
Returns the list of org names the authenticated user belongs to.

Called once during first-run setup (Phase 4+). The chosen org is persisted
in app settings and passed to `AzureDevOpsProvider` at construction.

---

## URL parser

Defined in `src/main/platforms/parsePRUrl.ts`.

```ts
function parsePRUrl(url: string): Result<PRRef, { code: "unrecognized_url"; url: string }>;
```

Handles these three URL forms:

| Platform     | URL pattern                                                             |
| ------------ | ----------------------------------------------------------------------- |
| GitHub       | `https://github.com/{owner}/{repo}/pull/{number}`                       |
| Azure DevOps | `https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{id}`    |
| Azure legacy | `https://{org}.visualstudio.com/{project}/_git/{repo}/pullrequest/{id}` |

Additional query parameters and fragments are ignored. Trailing slashes
are stripped before matching.

Returns `{ code: "unrecognized_url" }` for any URL that does not match one
of these patterns.

---

## HTTP transport and dependencies

| Need                  | Package                 | Notes                                      |
| --------------------- | ----------------------- | ------------------------------------------ |
| GitHub API calls      | `@octokit/rest`         | Official GitHub REST client                |
| Diff parsing          | `diff-parse` or similar | Parse unified diff strings into FileDiff[] |
| HTTP mocking in tests | `msw`                   | Mock Service Worker, Node integration      |

Before adding `diff-parse`, check whether Octokit's `/files` endpoint
response already provides enough structure (it includes `patch` as a
unified diff string per file). If a suitable parser already exists in the
dependency tree, prefer it over adding a new package.

---

## Testing

### Contract tests

`src/main/platforms/platformProviderContract.ts` exports a shared test
suite that both `GitHubProvider` and `AzureDevOpsProvider` must pass.
It mirrors the pattern of `authProviderContract.ts`.

The contract tests cover:

- `listOpenPullRequests` returns at least one `PullRequest` with required fields
- `getPullRequest` returns a matching `PullRequest` for a known `PRRef`
- `getDiff` returns a `Diff` with at least one `FileDiff`
- `postComment` returns a `Comment`
- `submitReview` resolves to `ok(undefined)`
- 404 responses are mapped to `not_found`
- 403 responses are mapped to `forbidden` (not `rate_limited`)
- 403 + `X-RateLimit-Remaining: 0` is mapped to `rate_limited`

### MSW handlers

Fixture handlers live in `src/main/platforms/__fixtures__/`.
Each handler returns a canned JSON response matching the real API shape.
MSW intercepts `fetch` (and Octokit's internal `fetch`) in the Node test
environment. No real network traffic in CI.

### URL parser tests

`parsePRUrl.test.ts` covers all three URL patterns plus malformed inputs.
No MSW needed — pure function.

---

## Exit criterion

A CLI script `scripts/fetch-pr.ts` accepts a PR URL as a command-line
argument, calls `parsePRUrl`, fetches the PR and its diff using the
appropriate provider, and prints the normalized `PullRequest` and `Diff`
as JSON to stdout.

```
VIGIL_LOG_LEVEL=debug node --experimental-strip-types scripts/fetch-pr.ts \
  https://github.com/acmecorp/backend/pull/42
```

The output is valid JSON containing the `PullRequest` and `Diff` shapes
defined in this spec. Tokens are absent from the output and logs.
