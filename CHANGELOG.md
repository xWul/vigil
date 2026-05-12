# Changelog — Vigil

All notable changes to Vigil are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Phase 2 — Platform providers and PR fetching**: `GitHubProvider`
  fetches PRs and diffs from GitHub using `@octokit/rest` (search-based
  review queue, per-file unified diff parsing into structured `Diff`).
  `AzureDevOpsProvider` does the same via raw `fetch` against the ADO
  REST API (iterations-based diff, file list with change types).
  `parsePRUrl` normalizes GitHub, dev.azure.com, and legacy
  visualstudio.com URLs into a typed `PRRef`. `discoverOrgs` returns
  the list of ADO organizations for a signed-in account. All providers
  accept a `Logger` for structured observability. 47 new tests using
  MSW for HTTP mocking; shared contract tests run against both providers.
- **`pnpm fetch-pr <url>`**: CLI script that accepts a PR URL, fetches
  the normalized `PullRequest` and `Diff`, and prints them as JSON.
  Phase 2 exit criterion.
- **Phase 2 spec and ADR-0002** (`docs/specs/pr-fetch-and-normalize.md`,
  `docs/adr/0002-platform-provider-abstraction.md`): full specification
  and design decisions for the `PlatformProvider` abstraction (per-call
  session injection, assignment-scoped list, separate `getDiff`,
  discriminated `PRRef`).

- **Observability foundation — Phase 1.5** (`src/shared/logger.ts`):
  `Logger` interface with `error/warn/info/debug` methods; `NoopLogger`
  (used by all tests — silent, zero dependencies); `ConsoleLogger`
  (structured stderr output, respects `VIGIL_LOG_LEVEL` env var,
  defaults to `error` level); `redact()` helper that strips values of
  keys matching `token|secret|key|password|pat` before any log is
  written. No Electron dependency — safe to import in Node.js scripts
  and test environments.
- **Auth flow instrumentation**: all Phase 1 providers
  (`AzureDevOpsAuthProvider`, `GitHubAuthProvider`, `PATAuthProvider`,
  `withRefreshRetry`) accept an optional `Logger` parameter defaulting
  to `NoopLogger`. Key lifecycle events (sign-in start/complete/failed,
  refresh attempt/outcome, sign-out) are logged per the event table in
  `docs/specs/observability.md`. Factory functions (`createAzureDevOpsAuthProvider`,
  `createGitHubAuthProvider`, `createPATAuthProvider`) updated to
  accept an optional `logger` argument.
- **Dev scripts wired up**: `pnpm auth:ado` and `pnpm auth:github` now
  inject `ConsoleLogger.fromEnv()` — set `VIGIL_LOG_LEVEL=info` (or
  `debug`) to see structured log output when running auth flows
  manually.

- **`withRefreshRetry`** (`src/main/auth/withRefreshRetry.ts`): generic
  utility that executes a `Result`-returning call, and on an "unauthorized"
  result (detected via a caller-supplied predicate), refreshes the session
  once, persists the new session, and retries exactly once. A second
  unauthorized after a successful refresh is returned as-is. Covered by 8
  unit tests.
- **`docs/specs/auth-refresh-retry.md`**: spec for the retry utility.

- **`PATAuthProvider`** (`src/main/auth/PATAuthProvider.ts`): implements
  `AuthProvider` for Personal Access Token sign-in. Accepts a PAT via an
  injected `askForPAT` callback (no network calls at sign-in), persists
  it under `"pat-github"` or `"pat-azure-devops"`, and treats the token
  as non-expiring. Returns `{ code: "cancelled" }` if the callback
  rejects and `{ code: "auth_failed" }` for empty input. Covered by 22
  unit tests and the `AuthProvider` contract tests for both platforms.
- **`docs/specs/auth-pat.md`**: spec for the PAT fallback auth flow.

- **`GitHubAuthProvider`** (`src/main/auth/GitHubAuthProvider.ts`):
  implements `AuthProvider` for the GitHub OAuth Device Flow. Presents a
  user code and verification URI via an injected callback, polls GitHub's
  token endpoint (handling `authorization_pending`, `slow_down`, `expired_token`,
  and `access_denied`), fetches the authenticated user's `login` and
  `displayName`, and persists the session to `TokenStore` under the key
  `"github"`. Token refresh is a no-op (GitHub OAuth App tokens do not
  expire); sign-out is local-only. Covered by 18 unit tests and the
  `AuthProvider` contract tests.
- **`scripts/test-auth-github.ts`**: Node.js integration script for the
  GitHub auth Phase 1 exit criterion. Presents the device code, waits for
  sign-in, prints `login` and `displayName`, and on a second run restores
  the session from file and prints "Restored from keychain".

- **`AzureDevOpsAuthProvider`** (`src/main/auth/AzureDevOpsAuthProvider.ts`):
  implements `AuthProvider` for the Microsoft Entra ID / Azure DevOps OAuth
  flow. Signs in via PKCE Authorization Code flow with a loopback HTTP
  listener, refreshes tokens via MSAL's `acquireTokenByRefreshToken`, and
  persists sessions to `TokenStore` under the key `"azure-devops"`. Sign-out
  is always local-first; server-side revocation is best-effort. Covered by
  unit tests and the new `AuthProvider` contract test.
- **`authProviderContract.ts`**: reusable `describeAuthProviderContract`
  helper that runs structural and behavioral assertions against any
  `AuthProvider` implementation. Used by `AzureDevOpsAuthProvider.test.ts`;
  ready to be reused for `GitHubAuthProvider`.
- **`scripts/test-auth-ado.ts`**: Node.js integration script for the Phase 1
  exit criterion. Calls `signIn()`, completes the browser flow, prints the
  `displayName` and `upn`, and on a second run restores the session from file
  and prints "Restored from keychain".

- **`TokenStore` interface and implementations** (`src/main/auth/`):
  `TokenStore` defines the `save`/`load`/`delete` contract; `KeychainTokenStore`
  persists sessions to the OS keychain via `@napi-rs/keyring`; `FileTokenStore`
  provides a plain-JSON fallback for development and CI. Contract tests in
  `TokenStore.test.ts` run against `FileTokenStore` and can be reused for
  `KeychainTokenStore` integration tests.
- **`AuthProvider` interface** (`src/main/auth/AuthProvider.ts`): defines
  the `AuthSession` discriminated union (`AzureDevOpsSession`, `GitHubSession`,
  `PATSession`), the `AuthError` discriminated union (six typed failure codes),
  and the `AuthProvider` interface that all sign-in implementations must satisfy.
- ADR-0004: OS Keychain for Token Storage — records the choice of
  `@napi-rs/keyring` over `keytar` (archived) and the `FileTokenStore`
  fallback for development/CI environments.
- ADR-0005: Result Type for Expected Failure Modes — records the
  hand-rolled `Result<T, E>` approach over exceptions or a library
  dependency for typed async error handling.
- **PKCE helpers** (`src/main/auth/pkce.ts`): `generateVerifier`,
  `deriveChallenge`, and `generatePkce` implement the RFC 7636 S256
  verifier/challenge pair used in the Azure DevOps OAuth flow.
- ADR-0003: PKCE Authorization Code Flow for Azure DevOps OAuth —
  records the flow choice, multi-tenant app registration model, upfront
  consent scopes, and single-session keychain design.
- `docs/specs/auth-azure-devops.md`: full specification for the Azure
  DevOps authentication flow, ready for implementation.
- `CONTEXT.md`: domain glossary with canonical definitions for
  AuthSession, AuthError, Account, and Organization.

- Project named **Vigil** — reflects the product's purpose of keeping
  watchful attention on incoming pull requests.
- Initial project documentation: `ARCHITECTURE.md`, `CLAUDE.md`,
  `ROADMAP.md`, and this changelog.
- ADR-0001: Electron over Tauri for the desktop shell.
- Licensed under Apache 2.0.
- Repository dotfiles: `.gitignore`, `.editorconfig`, `.nvmrc`
  (Node 24 LTS), `.npmrc` (pnpm-only, exact versions, strict hoisting).
- Placeholder index at `docs/specs/README.md` describing when and
  how to write feature specifications.
- `.claude/skills/` directory with a README describing project-scoped
  Claude Code skills.
- `grill-with-docs` skill (by Matt Pocock) for interview-style spec
  stress-testing and domain language sharpening.
- **Phase 0 build setup**: `package.json` with pinned versions
  (React 19.2.6, Electron 33, TypeScript 5.7, Vite 6, Vitest 3,
  Zustand 5), ESLint 9 flat config, Prettier, electron-vite.
- **TypeScript project references** for the dual-process app:
  `tsconfig.json` is a references-only root, `tsconfig.web.json`
  handles the renderer (React, DOM), `tsconfig.node.json` handles
  main + preload + shared (Node), `tsconfig.tools.json` handles
  the loose root-level config files. The split matches the actual
  runtime environments and lets ESLint's `projectService` discover
  the right project per file.
- **Source skeleton**: minimal main process with security defaults
  (context isolation on, node integration off, external links via
  `setWindowOpenHandler`), empty preload stub, React 19 renderer
  entry with a placeholder App component.
- **First shared module**: `Result<T, E>` type in
  `src/shared/result.ts` with full test coverage. Serves as both the
  project's error-handling convention and the smoke test that proves
  the test runner works.
- **CI workflow**: `.github/workflows/ci.yml` runs typecheck, lint,
  format check, and tests on every push and pull request to main.
- **VS Code workspace files**: `.vscode/extensions.json` and
  `.vscode/settings.json` for consistent editor behavior.

### Changed

- ADR criteria tightened to a strict three-rule test
  (hard-to-reverse + surprising-without-context + real-trade-off),
  matching the discipline enforced by the `grill-with-docs` skill.
  This prevents ADR sprawl and keeps every record worth reading.
- `CLAUDE.md` updated with sections on domain language, `CONTEXT.md`,
  and skill usage.
- `CLAUDE.md` updated with a React 19 convention note: do not
  annotate component return types — React 19 removed the global
  `JSX` namespace, and inferred return types are now idiomatic.

### Fixed

- ESLint flat config: `projectService: true` requires
  `allowDefaultProject` for root-level config files outside any
  composite project (`eslint.config.js`, `electron.vite.config.ts`,
  `vitest.config.ts`).
- ESLint flat config: type-checked rules must be disabled for those
  default-project files via `tseslint.configs.disableTypeChecked`,
  placed as the _last_ config block so it overrides earlier rule
  definitions (flat config is last-wins).
- ESLint flat config: scoped project-convention rules to `src/**`
  so they don't conflict with the config-file overrides.
- TypeScript: removed `composite: true` from `tsconfig.tools.json`
  to avoid the "inferred type cannot be named" portability error
  from pnpm's symlinked types.
- React 19: removed `JSX.Element` return type from `App.tsx`; the
  global `JSX` namespace no longer exists.

---

<!--
How to maintain this file:

Every change that affects observable behavior — new features, bug fixes,
breaking changes, security patches — gets an entry under [Unreleased]
in one of these sections:

  Added       — new features
  Changed     — changes in existing functionality
  Deprecated  — soon-to-be-removed features
  Removed     — now-removed features
  Fixed       — bug fixes
  Security    — vulnerabilities

Write entries in the user's voice: what changed for them, not how it
was implemented. Link to an ADR or spec when more context helps.

When cutting a release, move [Unreleased] entries to a new section:

## [0.2.0] - 2026-06-15

### Added
- Azure DevOps sign-in via Microsoft account.

Then start a fresh [Unreleased] block above it.
-->
