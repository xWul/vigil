# Spec: Local Repo Cache

## Goal

Reduce per-review API calls, enable cross-file context for AI passes,
and add offline resilience by maintaining a local clone of each reviewed
repository on disk.

---

## Background

The review pipeline fetches file content via `PlatformProvider.getFileContent`
— one HTTP request per changed file. On a 20-file PR this means 20 serial
API calls before analysis can start, consuming rate-limit quota and adding
meaningful latency. More importantly, `getFileContent` can only fetch files
that appear in the diff; it cannot reach imports, parent classes, or
utilities that were not changed but are required context for AI passes.

---

## Scope

- On-demand background cloning of reviewed repos using blobless partial clones
- Background fetch on re-open when the local clone is stale (> 15 minutes)
- Reading file content at any commit SHA from the local clone
- Cache eviction: age (30 days) and size (2 GB LRU cap)
- Status push events to the renderer (`git:cacheStatus`)
- Cross-file import enrichment for the consistency AI pass

**Out of scope (deferred):**

- Full checkouts or working-tree operations
- Watching for remote changes between reviews
- Tree-sitter symbol extraction

---

## Architecture

### `RepoCache` class (`src/main/git/RepoCache.ts`)

Manages all local clone state. Injected into the IPC handler layer at
startup; the renderer never interacts with it directly.

**Storage layout:**

```
{userData}/repos/
  github/{owner}/{repo}/
    .git/                    ← blobless partial clone
    .vigil-meta.json         ← { lastFetchAt: number }
  azure-devops/{org}/{project}/{repo}/
    .git/
    .vigil-meta.json
```

**Key constants:**

| Constant       | Value   | Meaning                                        |
| -------------- | ------- | ---------------------------------------------- |
| `STALE_MS`     | 15 min  | Minimum interval between fetches               |
| `EVICT_AGE_MS` | 30 days | Remove repos not fetched in this window        |
| `MAX_BYTES`    | 2 GB    | LRU eviction threshold across all cached repos |

### Clone strategy

Blobless partial clones (`--filter=blob:none --no-checkout`) fetch the
full object graph without file content blobs. Individual blobs are
fetched on demand by `git show {sha}:{path}`. This keeps clone time low
while still allowing per-file content reads at any commit.

```
git clone --filter=blob:none --no-checkout <remote-url> <repo-dir>
```

### Authentication

The remote URL embeds the access token:

- GitHub: `https://x-access-token:{token}@github.com/{owner}/{repo}.git`
- Azure DevOps: `https://:{token}@dev.azure.com/{org}/{project}/_git/{repo}`

The URL is constructed fresh for every clone/fetch operation from the
current `AuthSession`, so token rotation is handled automatically.

### `ensureCloned(session, ref)`

Fire-and-forget. Called when a PR is opened in the workspace. If the repo
is already cloned and fresh (within `STALE_MS`), returns immediately. If
stale, triggers a background fetch. If not yet cloned, triggers a background
clone. In-flight operations are deduplicated by `repoKey` — opening the
same PR twice only triggers one operation.

### `readFile(ref, sha, filePath)`

Returns `Result<string, RepoCacheError>`. If git is unavailable or the
repo is not yet cloned, returns `err({ code: "not_ready" })` — the caller
falls back to `PlatformProvider.getFileContent`. If the file does not exist
at the given SHA, returns `err({ code: "not_found", path })`.

Implemented via `simpleGit(repoDir).show(["{sha}:{filePath}"])`.

### Git availability check

Lazily checked once at first use via `git --version`. Requires git ≥ 2.22
(the version that introduced `--filter` for partial clones). If unavailable,
all `RepoCache` methods no-op silently. This covers CI environments and
machines without git installed.

---

## Status events

`RepoCache` emits `GitCacheStatusEvent` objects to a registered listener.
The listener in `src/main/ipc/index.ts` forwards them to the renderer as
`git:cacheStatus` push events.

```typescript
interface GitCacheStatusEvent {
  readonly repoKey: string; // "github/owner/repo"
  readonly status: "cloning" | "fetching" | "ready" | "error";
  readonly error?: string;
}
```

The renderer can display a subtle status indicator when a clone is in
progress, though it does not block any review functionality.

---

## Cross-file import enrichment

After the context builder assembles changed-file content, it optionally
fetches imported files from the cache to give the consistency AI pass
broader context.

**Algorithm (`buildReviewContext`):**

1. For each TypeScript/JavaScript file in the diff, extract all relative
   import specifiers via regex (`from '\./...'`).
2. Resolve each specifier to a repo-relative path, handling the TypeScript
   convention of `.js` extensions pointing to `.ts` source files.
3. Deduplicate; skip files already in the context (they were changed).
4. Fetch each candidate from `repoCache.readFile` and add to `context.files`
   until the cross-file budget is exhausted.

**Budget:** cross-file imports are capped at 20 % of the total token budget
(`CROSS_FILE_BUDGET_FRACTION = 0.2`), preventing imported context from
crowding out the diff or the changed files themselves.

**Graceful degradation:** if `repoCache` is not provided, or if
`readFile` returns `not_ready` or `not_found`, that file is silently
skipped. The review proceeds with whatever context is available.

The consistency pass prompt notes that some `<file>` entries may not
appear in the diff and should be treated as authoritative examples of
existing patterns when evaluating the diff.

---

## Eviction

`RepoCache.evict()` runs once at app startup (before any reviews begin).

1. Walk the cache directory for all `.vigil-meta.json` files.
2. Remove any repo whose `lastFetchAt` is older than `EVICT_AGE_MS`.
3. If total remaining size exceeds `MAX_BYTES`, remove the least-recently-fetched
   repos until under the cap.

Size is measured by walking the full directory tree recursively.

---

## Error handling

All git operations are wrapped in try/catch. Failures are:

- Logged at `warn` level with `{ key, message }`
- Emitted as `{ status: "error" }` events to the renderer
- Non-fatal — the review pipeline falls back to platform API calls

`RepoCache` never propagates exceptions to callers.

---

## Testing

Unit tests in `src/main/git/RepoCache.test.ts`:

- `repoKey` and `remoteUrl` are pure functions, tested directly
- `readFile` on a not-yet-cloned repo returns `not_ready`
- `readFile` when git is unavailable returns `not_ready`
- `evict` removes repos older than `EVICT_AGE_MS`
- `evict` skips repos with no meta file
- `evict` skips all operations when git is unavailable

Integration tests against a real git remote are not included — the unit
tests cover the logic; the `simpleGit` calls are the boundary.
