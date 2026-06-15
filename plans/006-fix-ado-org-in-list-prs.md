# Plan 006: Fix Azure DevOps org extraction in platform:listPRs

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1278cf3..HEAD -- src/main/ipc/index.ts src/main/platforms/AzureDevOpsProvider.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (changes live PR-fetch behavior for ADO users)
- **Depends on**: plans/004-ipc-handler-tests.md
- **Category**: bug
- **Planned at**: commit `1278cf3`, 2026-06-12

## Why this matters

`platform:listPRs` builds the `AzureDevOpsProvider` with the domain suffix of
the user's UPN as the org name. Concretely: if the user's Microsoft account is
`alice@contoso.onmicrosoft.com`, the provider is constructed with org
`"contoso.onmicrosoft.com"` — but the Azure DevOps org URL is
`https://dev.azure.com/contoso`, not
`https://dev.azure.com/contoso.onmicrosoft.com`. The API call therefore 404s
every time and ADO users see an empty review queue with no error surfaced (the
`!r.ok` branch just silently skips). This has existed since the ADO integration
shipped.

The `discoverOrgs` function already in `AzureDevOpsProvider.ts` solves the
exact problem — it calls the VSSPS accounts API to discover the real org names.
It is just not wired into `listPRs`.

## Current state

- `src/main/ipc/index.ts:150-168` — the `platform:listPRs` handler:

```typescript
// src/main/ipc/index.ts:150-168
  handle("platform:listPRs", async () => {
    const results: PullRequest[] = [];

    const githubSession = await loadSession(tokenStore, "github");
    if (githubSession) {
      const provider = new GitHubProvider(logger);
      const r = await provider.listOpenPullRequests(githubSession);
      if (r.ok) results.push(...r.value);
    }

    const adoSession = await loadSession(tokenStore, "azure-devops");
    if (adoSession && adoSession.provider === "azure-devops") {
      const provider = new AzureDevOpsProvider(adoSession.upn.split("@")[1] ?? "", logger);
      const r = await provider.listOpenPullRequests(adoSession);
      if (r.ok) results.push(...r.value);
    }

    return ok(results);
  });
```

- `src/main/platforms/AzureDevOpsProvider.ts:214-229` — `discoverOrgs`:

```typescript
// src/main/platforms/AzureDevOpsProvider.ts:214-229
export async function discoverOrgs(session: AuthSession): Promise<Result<string[], PlatformError>> {
  const profileResult = await adoRequest<AdoProfile>(
    adoUrl(`${VSSPS_BASE}/_apis/profile/profiles/me`, ""),
    session.accessToken,
  );
  if (!profileResult.ok) return profileResult;

  const userId = profileResult.value.id;
  const accountsResult = await adoRequest<{ value: { accountName: string }[] }>(
    adoUrl(`${VSSPS_BASE}/_apis/accounts`, `?memberId=${userId}`),
    session.accessToken,
  );
  if (!accountsResult.ok) return accountsResult;

  return ok(accountsResult.value.value.map((a) => a.accountName));
}
```

- `AzureDevOpsProvider.listOpenPullRequests` builds its query as
  `${this.base}/_apis/git/pullrequests?reviewerID=…` where
  `this.base = https://dev.azure.com/${this.org}`. Calling it once per
  discovered org is correct — each org has its own PR namespace.
- `AuthSession` shapes: `AzureDevOpsSession` has `upn` (e.g.,
  `alice@contoso.onmicrosoft.com`), `accessToken`, etc. Import from
  `src/main/auth/AuthProvider.ts`.
- The `handle` helper at `src/main/ipc/handlers.ts` registers handlers
  synchronously; the handler itself is async — no signature change needed.
- IPC handler tests (plan 004) will cover the `platform:listPRs` ADO path
  once this plan lands — in that test, stub `discoverOrgs` and assert that
  one provider per org is queried.
- Error-handling convention: `Result<T, E>` from `src/shared/result.ts`.
  A failure in `discoverOrgs` should not crash the whole list — match the
  existing pattern where ADO errors are silently skipped (`if (r.ok) …`).

## Commands you will need

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Typecheck | `pnpm typecheck`                     | exit 0              |
| IPC tests | `pnpm test src/main/ipc`             | all pass            |
| ADO tests | `pnpm test src/main/platforms/Azu`   | all pass            |
| Full gate | `pnpm check`                         | exit 0              |

## Scope

**In scope**:
- `src/main/ipc/index.ts` (only the `platform:listPRs` handler body)
- `src/main/ipc/index.test.ts` (extend the platform:listPRs test from plan 004)
- `CHANGELOG.md`

**Out of scope**:
- `discoverOrgs` itself — do not modify it.
- Other platform handlers (`getPRWithDiff`, `submitReview`, etc.) — they
  already use `ref.org` which is correct.
- Caching org discovery results across calls (a follow-up optimization; note
  it in Maintenance notes instead).
- Surfacing `discoverOrgs` failure as a user-visible error (maintain the
  current "silent skip" behavior to avoid breaking the PR queue if the org
  discovery endpoint is temporarily unavailable).

## Git workflow

- **Never commit to `main`.** Branch: `fix/ado-org-discovery-in-list-prs`
- `fix: use discoverOrgs to resolve ADO org names in platform:listPRs`

## Steps

### Step 1: Replace the UPN-split guess with discoverOrgs

In `src/main/ipc/index.ts`, in the `platform:listPRs` handler, replace:

```typescript
    const adoSession = await loadSession(tokenStore, "azure-devops");
    if (adoSession && adoSession.provider === "azure-devops") {
      const provider = new AzureDevOpsProvider(adoSession.upn.split("@")[1] ?? "", logger);
      const r = await provider.listOpenPullRequests(adoSession);
      if (r.ok) results.push(...r.value);
    }
```

with:

```typescript
    const adoSession = await loadSession(tokenStore, "azure-devops");
    if (adoSession && adoSession.provider === "azure-devops") {
      const orgsResult = await discoverOrgs(adoSession);
      if (orgsResult.ok) {
        for (const org of orgsResult.value) {
          const provider = new AzureDevOpsProvider(org, logger);
          const r = await provider.listOpenPullRequests(adoSession);
          if (r.ok) results.push(...r.value);
        }
      }
    }
```

Add `discoverOrgs` to the import from `"../platforms/AzureDevOpsProvider.js"`.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Extend IPC handler tests (depends on plan 004)

In `src/main/ipc/index.test.ts`, in the `platform:listPRs` tests:
- Add a test that stubs `discoverOrgs` to return `ok(["myorg"])` and the
  MSW handler for the ADO PR list endpoint, asserting the returned PRs include
  the ADO results.
- Add a test that stubs `discoverOrgs` returning `err(…)` — queue returns
  only GitHub PRs (no crash).

Use `vi.mock` or `vi.spyOn` on the `AzureDevOpsProvider` module's exported
`discoverOrgs`. Pattern: how GitHubProvider tests mock `@octokit/rest`.

**Verify**: `pnpm test src/main/ipc` → all pass.

### Step 3: Changelog + full gate

CHANGELOG `[Unreleased]` → `### Fixed`:
`- Azure DevOps review queue now correctly discovers org names instead of deriving them from the user's email domain (fixes the empty queue for most ADO users).`

**Verify**: `pnpm check` → exit 0.

## Test plan

- Extended `platform:listPRs` tests in `index.test.ts` (step 2).
- `pnpm test src/main/platforms/Azu` to confirm the ADO provider tests still
  pass (no production change in the provider itself).

## Done criteria

- [ ] `grep "upn.split" src/main/ipc/index.ts` → no matches
- [ ] `discoverOrgs` imported and called in `platform:listPRs`
- [ ] `pnpm check` exits 0
- [ ] ADO org-discovery tests in `index.test.ts` pass
- [ ] CHANGELOG Fixed entry present
- [ ] No files outside in-scope list modified
- [ ] `plans/README.md` status row updated

## STOP conditions

- `discoverOrgs` returns a different result type than `Result<string[], PlatformError>` at
  the live code location — report the actual type before editing the handler.
- PAT sessions (provider `"pat"`, platform `"azure-devops"`) also need ADO PR
  listing: check if `loadSession` can return a PAT session for `"azure-devops"`
  and whether `discoverOrgs` accepts it. If not, note it rather than fixing it
  ad hoc.

## Maintenance notes

- `discoverOrgs` makes 2 HTTP calls every time `platform:listPRs` is invoked.
  Caching the org list in-memory per session (TTL ~5 min) would be the next
  iteration. Not blocking.
- Plan 004 (IPC handler tests) establishes the test harness used in step 2;
  this plan's step 2 is not executable until plan 004 is DONE.
- If a user belongs to many ADO orgs (10+), the sequential per-org
  `listOpenPullRequests` calls will be slow. `Promise.all` parallelism is the
  natural follow-up — not done here to keep the diff minimal.
