# ADR-0011: TanStack Query for IPC-backed data fetching

## Status

Accepted — 2026-05-14

## Context

The renderer fetches data from the main process exclusively via
`api.invoke(channel, ...args)`. Each call is a typed, promise-returning
function — semantically identical to an HTTP fetch. Two screens drive
the bulk of this traffic:

**ReviewQueue** — on mount and every 60 s it calls `platform:listPRs`
then fans out N `review:getCached` calls. The implementation uses a
`loadKey` counter to trigger re-fetches, a `mounted` flag to guard
against stale updates, and manual `refreshing` / `screen` state
transitions. Silent refresh (showing stale rows while new data loads)
requires extra branching logic.

**WorkspaceScreen** — on PR open it calls `settings:get` and
`platform:getPRWithDiff` concurrently, then `review:getCached` serially.
Again: `mounted` flag, manual error state, manual loading state.

Both patterns are correct but verbose. The same boilerplate recurs for
every new data dependency.

## Decision

Adopt **TanStack Query v5** (`@tanstack/react-query`) for all
request/response IPC calls in the renderer.

A single `QueryClient` is created once in `main.tsx` and provided via
`QueryClientProvider`. Query key factories live in
`src/renderer/lib/queries.ts` to keep keys consistent across
invalidations.

### What moves to TanStack Query

| Channel | Query key |
|---|---|
| `platform:listPRs` | `["prs"]` |
| `review:getCached` | `["review", ref, headSha]` |
| `platform:getPRWithDiff` | `["diff", ref]` |
| `settings:get` | `["settings"]` |

### What stays manual

`review:run` is a long-running operation that pushes findings
incrementally via `review:finding` IPC events. It does not fit the
request/response model. It remains a fire-and-forget `api.invoke` call
with streaming state managed by `useEffect` + event listeners.

Similarly, `review:challenge` (streaming AI thread) stays manual.

### Cache invalidation

After `review:invalidate`, the workspace calls
`queryClient.invalidateQueries({ queryKey: ["review", ref, sha] })`
instead of resetting state manually. The diff query is not invalidated
(the diff did not change).

## Consequences

**Good:**
- `ReviewQueue` drops ~40 lines: no `loadKey`, no `mounted`, no manual
  `refreshing` state. Stale-while-revalidate is free via
  `placeholderData: keepPreviousData`.
- `WorkspaceScreen` drops the parallel `useEffect` + settings fire;
  both become `useQuery` hooks that TanStack Query deduplicates and
  caches automatically.
- `refetchInterval: 60_000` on the PR list query replaces the manual
  `setInterval` in `ReviewQueue`.
- Query retries, window-focus refetch, and devtools are opt-in without
  additional code.

**Neutral:**
- New dependency (~13 kB gzipped). Justified: the functionality it
  replaces is ~80 lines of hand-rolled boilerplate today and would grow
  as more screens are added.

**Watch out for:**
- The `QueryClient` must be created outside `App` to survive re-renders.
- `staleTime` should be set to at least `30_000` on the PR list to
  avoid redundant fetches when the user tabs back to the queue.
