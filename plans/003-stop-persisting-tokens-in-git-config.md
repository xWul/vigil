# Plan 003: Stop persisting platform tokens in .git/config and scrub git errors

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1278cf3..HEAD -- src/main/git/RepoCache.ts src/main/git/RepoCache.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (touches clone/fetch behavior of the repo cache)
- **Depends on**: plans/002-harden-logger-redaction.md
- **Category**: security
- **Planned at**: commit `1278cf3`, 2026-06-12

## Why this matters

Vigil's security model (ARCHITECTURE.md §10) states: "Token theft from disk —
OS keychain only; never written to plain files or logs." The repo cache
violates this today, twice:

1. **Disk**: `remoteUrl()` embeds the live access token in the git remote URL.
   `_clone` passes that URL to `git clone` (git persists the origin URL —
   token included — into `<repo>/.git/config`), and `_fetch` makes it worse by
   running `git remote set-url origin <tokenized-url>` explicitly. Every cached
   repo under `{userData}/repos/` holds a plaintext copy of the user's GitHub
   OAuth token or Azure DevOps token/PAT.
2. **Logs**: when a clone/fetch fails, git's error message usually contains
   the full remote URL. `_triggerCloneOrFetch` logs that message as a value
   (`logger.warn("git.cache.error", { key, message })`), and key-based
   redaction does not touch values. Plan 002 adds value scrubbing as a net;
   this plan removes the token from the URL entirely so there is nothing to
   scrub.

After this plan: `.git/config` contains only tokenless URLs, credentials are
passed to git per-invocation via environment variables (never argv, never
disk), and existing caches are migrated on their next fetch.

## Current state

- `src/main/git/RepoCache.ts` — the whole cache. Key excerpts as of `1278cf3`:

```typescript
// src/main/git/RepoCache.ts:57-63
export function remoteUrl(session: AuthSession, ref: PRRef): string {
  const token = session.accessToken;
  if (ref.platform === "github") {
    return `https://x-access-token:${token}@github.com/${ref.owner}/${ref.repo}.git`;
  }
  return `https://:${token}@dev.azure.com/${ref.org}/${ref.project}/_git/${ref.repo}`;
}
```

```typescript
// src/main/git/RepoCache.ts:189-191 (inside _clone)
    mkdirSync(dirname(repoDir), { recursive: true });
    const url = remoteUrl(session, ref);
    await simpleGit().clone(url, repoDir, ["--filter=blob:none", "--no-checkout"]);
```

```typescript
// src/main/git/RepoCache.ts:208-211 (inside _fetch)
    const url = remoteUrl(session, ref);
    const git = simpleGit(repoDir);
    await git.remote(["set-url", "origin", url]);
    await git.fetch(["--filter=blob:none"]);
```

```typescript
// src/main/git/RepoCache.ts:167-171 (inside _triggerCloneOrFetch)
      .catch((e) => {
        const message = e instanceof Error ? e.message : String(e);
        this.logger.warn("git.cache.error", { key, message });
        this.emit({ repoKey: key, status: "error", error: message });
      })
```

- `src/main/git/RepoCache.test.ts` — existing tests; `describe("remoteUrl")`
  currently asserts the token IS in the URL (lines ~47-60). These assertions
  must be inverted by this plan.
- `AuthSession` shapes (`src/main/auth/AuthProvider.ts`): discriminated union on
  `provider`: `"github"` (has `accessToken`), `"azure-devops"` (has
  `accessToken`, refresh token, expiry), `"pat"` (has `accessToken` and a
  `platform` field). All carry `accessToken`.
- Git auth mechanics you will implement:
  - GitHub HTTPS: header `Authorization: basic base64("x-access-token:" + token)`.
  - Azure DevOps OAuth (provider `"azure-devops"`): header `Authorization: Bearer <token>`.
  - Azure DevOps PAT (provider `"pat"`, platform `"azure-devops"`): header
    `Authorization: basic base64(":" + token)`.
  - Git can receive per-invocation config via environment variables with NO
    argv or disk exposure: `GIT_CONFIG_COUNT=1`,
    `GIT_CONFIG_KEY_0=http.extraHeader`, `GIT_CONFIG_VALUE_0=Authorization: …`
    (supported since git 2.31; the cache already requires git ≥ 2.22 via
    `checkGitAvailable` — raise that floor to 2.31 in the same function).
  - simple-git supports per-instance environment via `.env(name, value)` /
    `.env(object)` on the instance returned by `simpleGit()`.
- Repo conventions: `Result<T, E>` for expected failures (see
  `src/shared/result.ts`), strict TS, no `any`. Mock the boundary in tests,
  not the unit.

## Commands you will need

| Purpose   | Command                            | Expected on success |
|-----------|------------------------------------|---------------------|
| Typecheck | `pnpm typecheck`                   | exit 0              |
| This test | `pnpm test src/main/git/RepoCache` | all pass            |
| Full gate | `pnpm check`                       | exit 0              |

## Scope

**In scope**:
- `src/main/git/RepoCache.ts`
- `src/main/git/RepoCache.test.ts`
- `CHANGELOG.md`

**Out of scope**:
- `src/shared/logger.ts` — plan 002 already hardened it; you may import
  `scrubString` from it.
- `src/main/auth/**` — session shapes are fixed; do not modify.
- `buildReviewContext.ts` / callers — the `RepoCache` public API
  (`ensureCloned`, `readFile`, `evict`, `setStatusListener`) must not change.
- Token rotation guidance: users who used v0.1.0 already have tokens on disk
  in old caches. The migration in step 4 scrubs them on next fetch, but DO add
  the CHANGELOG note telling users they can also clear `{userData}/repos/`.
  Do not build any UI for this.

## Git workflow

- **Never commit to `main`.** Branch: `fix/repo-cache-token-persistence`
- Conventional commit, e.g.:
  `fix: pass git credentials via env instead of persisting in remote URL`
- CHANGELOG entry in the same commit.

## Steps

### Step 1: Tokenless URLs + auth header helper (tests first)

In `RepoCache.test.ts`, update the `remoteUrl` describe block: the GitHub URL
must be exactly `https://github.com/acme/api.git` and the ADO URL
`https://dev.azure.com/myorg/myproj/_git/myrepo` — no credentials. Add a new
describe for a new exported function `authHeader(session: AuthSession): string`:

- github session → `basic ` + base64 of `x-access-token:<token>`
- azure-devops session → `Bearer <token>`
- pat session (platform azure-devops) → `basic ` + base64 of `:<token>`
- pat session (platform github) → `basic ` + base64 of `x-access-token:<token>`

(Token values in tests are obviously-fake fixtures like `"ghp_token"` — fine
in test code; never echo real values.)

**Verify**: `pnpm test src/main/git/RepoCache` → new tests fail (red).

### Step 2: Implement

In `RepoCache.ts`:

1. Change `remoteUrl(ref: PRRef)` to drop the `session` parameter and return
   the tokenless URL. (It is exported — check for other importers first:
   `grep -rn "remoteUrl" src/` — at `1278cf3` only RepoCache.ts and its test.)
2. Add `export function authHeader(session: AuthSession): string` per step 1.
   Use `Buffer.from(...).toString("base64")`.
3. Add a private helper that returns the env vars for an authenticated git
   invocation:

```typescript
function gitAuthEnv(session: AuthSession): Record<string, string> {
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: ${authHeader(session)}`,
  };
}
```

4. `_clone`: replace the single `clone` call with an env-scoped instance.
   simple-git's `.env()` REPLACES the child process environment rather than
   merging, so spread `process.env` in:

```typescript
const git = simpleGit().env({ ...process.env, ...gitAuthEnv(session) });
await git.clone(remoteUrl(ref), repoDir, ["--filter=blob:none", "--no-checkout"]);
```

   Because the URL is now tokenless, whatever git writes to `.git/config` is safe.
5. `_fetch`: keep the `remote set-url origin` call but with the tokenless URL —
   this is the migration that scrubs tokens out of caches created by v0.1.0.
   Then fetch with the env applied:

```typescript
const git = simpleGit(repoDir).env({ ...process.env, ...gitAuthEnv(session) });
await git.remote(["set-url", "origin", remoteUrl(ref)]);
await git.fetch(["--filter=blob:none"]);
```

6. In `checkGitAvailable`, raise the minimum from 2.22 to 2.31 (the
   `GIT_CONFIG_*` env mechanism's floor) and update the warning text.
7. In the `.catch` of `_triggerCloneOrFetch`, run the message through
   `scrubString` (import from `../../shared/logger.js`) before logging and
   emitting — belt and suspenders even with tokenless URLs.

**Verify**: `pnpm test src/main/git/RepoCache` → all pass; `pnpm typecheck` → exit 0.

### Step 3: Prove no token reaches disk (integration-style test)

Add a test that constructs a `RepoCache` in a temp dir, calls the private
clone path against a **local fixture remote** (create a bare git repo in a
temp dir with `git init --bare` via execFile, then a tiny clone+commit+push to
it — file protocol, no network, no auth needed), then asserts:

- `readFileSync(join(repoDir, ".git", "config"), "utf-8")` does not match
  `/x-access-token|Bearer|:.*@/` beyond the file-URL remote.

If driving the private methods proves awkward, test through `ensureCloned` +
polling `existsSync(join(repoDir, ".git"))` with vitest's `vi.waitFor`. Model
temp-dir setup/teardown after the existing `beforeEach`/`afterEach` in
`RepoCache.test.ts`.

NOTE: with a `file://` remote the auth env is unused — the point of this test
is that the URL written to config comes from `remoteUrl(ref)` and contains no
credential pattern. The header-correctness is covered by the `authHeader`
unit tests in step 1.

**Verify**: `pnpm test src/main/git/RepoCache` → all pass.

### Step 4: Changelog + full gate

CHANGELOG `[Unreleased]` → `### Security` (two entries):
- `- Platform access tokens are no longer written into cached repos' .git/config; credentials are now passed to git per-invocation and never stored on disk.`
- `- Existing caches are scrubbed on next fetch. If you used v0.1.0, you can also clear the repo cache folder (userData/repos) and, to be safe, rotate your PAT.`

**Verify**: `pnpm check` → exit 0.

## Test plan

- `remoteUrl` tests inverted (no credentials in URL) — step 1.
- `authHeader` unit tests, all four session shapes — step 1.
- Disk-safety integration test against a local fixture remote — step 3.
- Pattern to follow: existing `RepoCache.test.ts` (temp dirs via `mkdtempSync`,
  fixtures at top of file).

## Done criteria

- [ ] `pnpm check` exits 0
- [ ] `grep -n "accessToken" src/main/git/RepoCache.ts` shows accessToken used ONLY inside `authHeader`
- [ ] No `remoteUrl` call site receives a session
- [ ] `.git/config` disk-safety test exists and passes
- [ ] CHANGELOG Security entries present
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- simple-git's `.env()` is not available or behaves differently in the
  installed version (`pnpm ls simple-git` — expect ^3.36.0): report instead of
  switching to argv-based `-c` flags. **Argv-based `-c http.extraHeader=...`
  is explicitly forbidden** — it leaks the token to `ps`.
- `grep -rn "remoteUrl" src/` reveals importers outside RepoCache and its test.
- Azure DevOps fetch with Bearer/extraHeader fails in your environment in a way
  that suggests ADO needs a different header form — do not guess at
  alternatives; report the exact git error (scrubbed).

## Maintenance notes

- If a `getFileContent`-style blob fetch or any new git operation is added to
  RepoCache, it MUST go through the same `gitAuthEnv` path — never a tokenized
  URL. A reviewer seeing `@` inside a constructed git URL should block the PR.
- The git floor is now 2.31 (released 2021) — update the README requirements
  line if one exists (`grep -n "2.22" README.md`).
- Deferred deliberately: proactively rewriting `.git/config` of all existing
  caches at startup (migration happens lazily on next fetch; eviction ages out
  the rest within 30 days).
