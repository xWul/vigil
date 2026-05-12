# ADR-0002: PlatformProvider Abstraction

## Status

Accepted — 2026-05-12

## Context

Vigil needs to fetch pull requests, diffs, and review threads from two
very different APIs: GitHub REST (via `@octokit/rest`) and Azure DevOps
REST (raw `fetch`). The AI review pipeline, the IPC layer, and the review
queue all need to work with PRs regardless of origin. Without an
abstraction, every consumer would need conditional logic for each platform.

Several non-obvious design questions arose:

1. Should the session be injected at construction or passed per-call?
2. Should `getDiff` be a separate method from `getPullRequest`?
3. What error type should the interface surface?
4. Should listing PRs be repo-scoped or assignment-scoped?

## Decision

### Common interface over platform-specific interfaces

`PlatformProvider` is a single interface implemented by `GitHubProvider`
and `AzureDevOpsProvider`. All consumers depend only on the interface.
Adding a third platform (GitLab, Bitbucket) requires a new implementation,
not changes to consumers.

### Per-call session injection

```ts
getPullRequest(session: AuthSession, ref: PRRef): Promise<Result<PullRequest, PlatformError>>
```

The session is passed on every call rather than stored at construction.
This keeps providers stateless with respect to credentials: when
`withRefreshRetry` replaces a stale session after a 401, the new session
flows into the retry without constructing a new provider instance or
mutating internal state. This follows the same pattern as the existing
auth utilities.

### `getDiff` is separate from `getPullRequest`

Fetching metadata and fetching the diff are different API calls on both
platforms. Keeping them separate lets the review queue load PR metadata
cheaply without fetching diffs for every PR. The AI pipeline calls both
independently. Combining them into one method would force the diff to be
fetched every time metadata is needed, which is expensive at queue scale.

### Typed `PlatformError` union; 401 is not a platform error

`PlatformError` covers: `not_found`, `forbidden`, `rate_limited`,
`network`, `platform_error`. HTTP 401 is excluded — it signals token
expiry and is handled one level up by `withRefreshRetry` before the
caller ever sees it. This separation keeps platform error handling free
of auth concerns.

### `listOpenPullRequests` is assignment-scoped

The method lists PRs where the authenticated user is a requested reviewer.
There is no separate `PRScope` type. The product is a review queue, not a
repo browser; surfacing every open PR in a repo would flood the queue with
items the user is not expected to review. Repo-browsing is deferred.

### Discriminated `PRRef` union

```ts
type PRRef = { platform: "github"; owner: string; repo: string; number: number } | { platform: "azure-devops"; org: string; project: string; repo: string; id: number };
```

The routing information is platform-specific and non-overlapping. A
flat struct with optional fields would allow passing a GitHub ref to the
Azure DevOps provider; TypeScript cannot catch that at compile time. The
discriminated union makes misrouting a type error.

### `AzureDevOpsProvider` takes `org` at construction; discovery is separate

The org is required to form any Azure DevOps API URL. Discovery (calling
`/_apis/accounts`) is a one-time setup concern, not a runtime concern.
A standalone `discoverOrgs(session)` utility handles it; the provider
itself receives the org string at construction and never performs
discovery. This keeps the provider simple and makes the org selection UI
in Phase 4 a clean call to `discoverOrgs` with no side effects inside
the provider.

## Consequences

### Positive

- All consumers are platform-agnostic. Adding a third platform is additive.
- Stateless providers compose cleanly with `withRefreshRetry`.
- Separate `getDiff` avoids loading diffs in list views.
- `PRRef` makes misrouting a compile-time error.
- Contract tests (`platformProviderContract.ts`) verify that both
  implementations satisfy the same behavioral expectations.

### Negative

- Two `fetch` strategies (`@octokit/rest` for GitHub, raw `fetch` for
  Azure DevOps) means two mental models for contributors. This is
  accepted because the Azure DevOps SDK's auth model is incompatible
  with `AuthSession`.
- Per-call sessions add a parameter to every method signature. Slightly
  noisier than constructor injection at the call site.

## Alternatives Considered

### Constructor-injected session

```ts
new GitHubProvider(session, tokenStore);
```

Simpler call sites, but the provider holds a reference to a session that
may expire. When `withRefreshRetry` obtains a new session, the provider
instance would need to be reconstructed or the session mutated. Per-call
injection avoids this entirely.

### Single `getPullRequestWithDiff` method

Simpler interface, but forces diff fetching for every PR in the queue.
ADO diff fetching requires multiple API calls; doing this for every PR
in `listOpenPullRequests` would be prohibitively slow.

### Platform-specific interfaces

No shared `PlatformProvider`. Each consumer checks the platform and calls
the right type directly.

Not chosen: the AI pipeline and IPC layer would each need conditional
dispatch. Every new platform would require changes in multiple consumers.
The abstraction cost is low; the benefit at two platforms is already real.

## References

- `docs/specs/pr-fetch-and-normalize.md`
- ADR-0005: Result type for error handling
- `src/main/auth/withRefreshRetry.ts`
- `ARCHITECTURE.md` §6.3 (PlatformProvider sketch)
