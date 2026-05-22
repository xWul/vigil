# ADR-0010: Local repo cache using simple-git and blobless clones

## Status

Accepted — 2026-05-14

## Context

The review pipeline (`buildReviewContext`) currently fetches full file
content via the platform API (`provider.getFileContent`). This works
but has three weaknesses:

1. **N API calls per review.** One HTTP request per changed file burns
   rate-limit quota and adds latency. A 20-file PR makes 20 sequential
   API calls before analysis can begin.
2. **Diff-only context.** The pipeline can only fetch files that appear
   in the diff. It cannot reach imports, parent classes, or related
   utilities in files that were not changed — context the AI passes use
   heavily.
3. **No offline capability.** A network hiccup during context building
   fails the review entirely.

Phase 6 introduces a **local repo cache**: a git clone of each reviewed
repository stored on disk so the pipeline can read any file at any
commit without an API call.

Three decisions must be made:

- **Which git library** handles clone, fetch, and file-read operations.
- **Which clone strategy** minimises disk and network cost.
- **Where and how** the cache is stored and evicted.

### Git library options

**`simple-git`** is a Node.js library that wraps the system git binary
via `child_process`. It exposes a typed async API over the full git
feature set. Every git operation available on the command line is
available through `simple-git`.

**`isomorphic-git`** is a complete reimplementation of git in pure
JavaScript. It requires no system git binary, which makes it usable
in browsers and locked-down environments.

**Rolling our own `child_process` wrapper** is what VS Code does in
`extensions/git/src/git.ts`. Maximum control, no third-party
dependency, but significant implementation surface.

### Clone strategy options

**Full clone** downloads the entire history and all blobs. Safe and
simple, but slow for large repositories (multi-GB downloads for
monorepos).

**Blobless clone** (`--filter=blob:none`) downloads all commits and
trees (directory structure) but fetches blob content (file data) on
demand. Introduced in git 2.17; reliable from git 2.22. The initial
clone is fast regardless of repo size, and only the files actually
read are fetched from the remote.

**Treeless clone** (`--filter=tree:0`) downloads only the commits
referenced by the cloned branches, fetching trees and blobs on demand.
Fastest initial clone, but requires a network round-trip for every
`git checkout` and makes local history traversal impractical.

## Decision

Use **`simple-git`** wrapping the system git binary, with
**blobless clones** (`--filter=blob:none --no-checkout`).

Repos are cached at:

```
app.getPath('userData')/repos/{owner}/{repo}/
```

Files are read via `git show {sha}:{path}` rather than a working tree
checkout, so `--no-checkout` keeps the clone directory small.

A repo cache entry is refreshed (via `git fetch --filter=blob:none`)
when the last fetch timestamp is older than **15 minutes** at PR open
time. Stale entries older than **30 days** are deleted on startup.
Total cache size is capped at **2 GB**; when the cap is exceeded, the
least-recently-used repos are deleted first.

## Consequences

### Positive

- **No API calls for file content.** After the initial clone, reading
  any file at any commit is a local operation. Rate-limit quota is
  preserved entirely for PR listing and metadata.
- **Full codebase context.** The pipeline can fetch files outside the
  diff — imports, parent classes, shared utilities — enabling smarter
  cross-file findings in the consistency pass.
- **VS Code-aligned philosophy.** VS Code's git extension also wraps
  the system git binary. Using `simple-git` adopts the same approach
  with a maintained library instead of hand-rolled `child_process`.
- **Full git feature set.** Blame, log, symbolic refs, sparse checkout
  — all available if needed in future passes.
- **Blobless initial clone is fast.** A large monorepo clones in
  seconds rather than minutes because no file blobs are downloaded
  upfront. Only files actually accessed are fetched.

### Negative

- **Requires system git ≥ 2.22.** Machines without git or with very
  old versions cannot use the cache. Mitigation: gate the cache on a
  `git --version` check at startup; fall back gracefully to the
  existing platform API path if git is absent or too old.
- **Disk usage.** Cached repos consume disk space. Mitigated by the
  30-day eviction and 2 GB size cap.
- **Clone on first open adds latency.** The first time a repo is
  reviewed, a clone is required. Mitigation: start the clone in the
  background when the PR is opened; use the existing API path while
  the clone is in progress, then switch to local reads on subsequent
  reviews.
- **Authentication for clone.** The git clone must authenticate with
  the platform (GitHub, Azure DevOps). Mitigation: use the existing
  `AuthSession` access token as the HTTP credential
  (`https://{token}@github.com/{owner}/{repo}`). Never written to
  disk; passed only to `simple-git` at clone/fetch time.

### Operational follow-ups

- Add `simple-git` to `dependencies` (not `devDependencies`).
- Implement `src/main/git/RepoCache.ts` with:
  - `ensureCloned(session, ref)` → clones if absent, fetches if stale
  - `readFile(ref, sha, path)` → `git show {sha}:{path}`
  - `evict()` → runs on startup, enforces age and size limits
- Modify `buildReviewContext` to call `RepoCache.readFile` instead of
  `provider.getFileContent`, with a fallback to the API path if the
  cache is not yet ready.
- Add `git:cacheStatus` IPC channel so the UI can show a subtle
  indicator when a background clone is in progress.
- Document the git ≥ 2.22 requirement in `README.md`.

## Alternatives Considered

### `isomorphic-git`

Pure JavaScript, no system git dependency. The appeal is that it
works in any Node environment regardless of what tools are installed.

Reasons not chosen:

- **Not what Vigil's users have.** Every developer who reviews pull
  requests has git installed. The system-dependency concern that
  motivates `isomorphic-git` does not apply here.
- **Performance.** For large repositories, `isomorphic-git`'s pure-JS
  implementation is significantly slower than the native git binary.
- **Feature gaps.** Some git features (partial clones, credential
  helpers, specific remote transports) are absent or incomplete in
  `isomorphic-git`.
- **Maintenance.** `simple-git` is more actively maintained and
  widely adopted (2M+ weekly downloads).

### Rolling our own `child_process` wrapper

This is VS Code's approach. Maximum control, no third-party dependency.

Reasons not chosen:

- **Implementation surface.** Writing a robust async wrapper around
  `child_process` — handling stderr, exit codes, encoding, concurrent
  invocations, timeouts — is non-trivial. `simple-git` has already
  solved this.
- **Solo project.** The overhead of maintaining a custom git wrapper
  is not justified for one developer. `simple-git` provides the same
  result with less code to own.

### Keep using the platform API

Continue calling `provider.getFileContent` for every file, with no
local cache.

Reasons not chosen:

- **Rate limits.** GitHub's REST API has hourly rate limits. A power
  user reviewing 20 PRs per day, each touching 20 files, makes 400
  file-content API calls before hitting the cap.
- **Cross-file context is impossible.** The consistency and complexity
  passes would benefit enormously from being able to read files not
  in the diff. The platform API cannot serve this efficiently.
- **Latency.** 20 sequential API calls adds 2-5 seconds to every
  review start. Local reads add microseconds.

## References

- [`simple-git` npm](https://www.npmjs.com/package/simple-git)
- [Git partial clones documentation](https://git-scm.com/docs/partial-clone)
- [VS Code git extension source](https://github.com/microsoft/vscode/blob/main/extensions/git/src/git.ts)
- ADR-0001 (Electron over Tauri) — references `simple-git` as a planned dependency
- `src/main/ai/buildReviewContext.ts` — the consumer of the cache
