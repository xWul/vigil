# Changelog — Vigil

All notable changes to Vigil are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Auto-update**: Vigil now checks for updates automatically on launch (5 s after startup,
  packaged builds only). Updates are downloaded silently in the background; the Settings
  screen shows current version, download progress, and a "Restart to install" button when
  a new version is ready. Uses `electron-updater` against GitHub Releases
  (`xWul/vigil`). GitHub publish config added to `electron-builder`.

- **System notification on review complete**: Vigil fires a macOS notification when a
  review finishes while the window is out of focus. The notification shows the PR title
  and a count of medium/high/critical findings (or "No significant findings"). Uses
  `Notification.isSupported()` so it degrades silently on unsupported platforms.

- **Workspace tab persistence**: the active tab (Overview, Diff, Semantic, etc.) is
  remembered per PR across sessions using `localStorage`. Returning to a PR you were
  already reviewing opens the same tab you left on.

- **Finding suppression**: findings can now be marked as "won't fix" so they don't
  clutter re-runs. Press `x` on a focused finding (diff tab) or click the ✕ button
  on any finding card (overview tab) to suppress it. Suppressed findings disappear from
  the list; a "N suppressed · clear" link appears in the overview when any are hidden.
  Suppressions are stored per repo and head SHA in Electron `userData` — they clear
  automatically when the branch is updated. Two new IPC channels:
  `findings:getSuppressed` and `findings:setSuppressed`.

- **Configurable analyzer settings** (Phase 8): every static analyzer parameter is now
  user-configurable per repository. Settings are stored in Electron `userData` as a JSON
  file keyed by platform/owner/repo (never committed to the repository). Analyzers receive
  a fully-resolved config at construction time via constructor injection. All eight analyzers
  support `enabled: true/false`; `ComplexityAnalyzer`, `SmellsAnalyzer`, and `DuplicationAnalyzer`
  expose numeric thresholds; `SilentRegressionAnalyzer` exposes per-detector toggles;
  `ChangeClassifierAnalyzer` exposes the intent-mismatch flag. `maxFindingsPerAnalyzer` is
  also configurable. Two new IPC channels (`settings:getAnalyzerConfig`,
  `settings:setAnalyzerConfig`) expose the config to the renderer.

- **Analyzer settings overlay**: pressing `,` in the workspace (or clicking the new "settings"
  button in the bottom strip) opens a scrollable overlay showing all analyzer controls — toggles
  and numeric inputs grouped by analyzer. "Restore defaults" resets to factory values. "Copy
  .vigilrc" copies a minimal JSON snippet (only non-default values) to the clipboard. "Save"
  persists the config and closes the overlay. Changes apply on the next re-run.

- **`.vigilrc` auto-read from repository**: Vigil now reads a `.vigilrc` file from the
  repository root (at the PR's head SHA) if one exists. Settings in `.vigilrc` override the
  per-repo settings stored in `userData`, which in turn override built-in defaults. The file
  uses the same `AnalyzerConfig` JSON schema as the exported snippet from the settings overlay.
  Invalid JSON in `.vigilrc` is silently ignored.

- **Symbol-aware cross-file context**: unchanged files pulled in as cross-file import context
  are now compressed to their exported symbol signatures (function signatures, class public API,
  interfaces, type aliases) using the TypeScript compiler API — implementation bodies are
  stripped. This makes better use of the cross-file token budget: more imported modules can be
  included within the same cap, giving the AI broader type context without extra cost.

### Changed

- **Static analyzer accuracy improvements** — five targeted fixes to the static analysis pipeline:
  - `ComplexityAnalyzer` no longer inflates the outer function's cyclomatic complexity score
    with branches that belong to nested inner functions (arrow functions, closures). Each
    function is now measured independently.
  - `ComplexityAnalyzer` and `SmellsAnalyzer` now scope findings to functions that overlap
    the changed diff hunks. Unrelated pre-existing smells in modified files no longer appear.
  - `SilentRegressionAnalyzer` "catch block removed" finding now reports `medium` severity
    when the removed catch lines are accompanied by replacement code (likely a refactor that
    delegates to a helper), reserving `high` for pure catch deletions with no replacement.
  - `DuplicationAnalyzer` no longer flags files that share common `import`/`export` declarations
    as duplicated code. Module-level structural lines are filtered before block extraction.
  - `ChangeClassifierAnalyzer` now classifies deleted source files as `refactor` rather than
    `behavior`. Deleting code removes behavior — it does not introduce it — and the previous
    classification caused false-positive intent-mismatch findings on cleanup PRs.

### Added

- **First-run onboarding nudge**: the Review Queue now shows a persistent amber banner below
  the header when no AI provider is configured (`aiProvider` is null or the selected
  provider has no key). The banner links directly to Settings. Disappears automatically once
  a key is saved.

- **Copy diagnostics**: Settings → Diagnostics section → "Copy diagnostics" button reads the
  application log (`vigil.log` + `.old` archive), applies belt-and-suspenders redaction of
  inline sensitive values (tokens, secrets, keys, passwords), and writes the result to the
  clipboard. Button shows "Copied!" feedback for 2 seconds. Adds `app:copyDiagnostics` IPC
  channel.

- **Workspace keyboard shortcuts overlay**: pressing `?` in the workspace shows a centered
  overlay listing all keyboard shortcuts (Tab, j/k, n/p, m, r, Esc, ?). The `?` hint in the
  bottom strip is now a clickable button labeled "shortcuts". `Esc` dismisses the overlay
  before any other action. `r` is now wired as a shortcut for re-run review.

- **Semantic tab wired to real findings**: the Semantic tab now shows live regression findings
  from the static analysis pipeline instead of hardcoded demo data. Each `Finding` with
  `pass === "regression"` is mapped to a `SemanticChange` card with before/after code
  blocks parsed from the finding's evidence, explanation, and risk level. Empty state shown
  when no regressions were detected. The "AI · Claude 3.7" badge removed — regression
  findings are from static analysis, not AI.

- **Architecture tab — circular dependency detection**: the Architecture tab now shows real
  findings produced by the new `ArchitectureAnalyzer`. It builds an import graph from all
  files in the review context (relative `.js`/`.ts` imports only), runs DFS cycle detection,
  and reports cycles that touch at least one changed file. Each finding displays the full
  import chain as a breadcrumb, the participating file and line number, and a plain-English
  description. Empty state shown when no cycles are detected. Path-alias imports (`@/`) are
  not resolved (noted in the tab footer). Replaces the previous hardcoded demo data.

- **Re-run review**: a "Re-run review" button appears in the workspace bottom strip once analysis
  completes. Clicking it invalidates the cached result for the current head SHA, resets all findings
  and pass state, and re-runs the full pipeline in the background. The "Analyzing" strip appears
  immediately — no gap between clicking and the first pass event.

- **Diff skeleton loader**: the workspace now shows a pulsing animated skeleton while the diff is
  loading, replacing the plain "Loading diff…" text.

- **TanStack Query for IPC data fetching** (ADR-0011): `@tanstack/react-query` adopted for all
  request/response IPC calls in the renderer. `ReviewQueue` drops the `loadKey` counter, `mounted`
  flags, and manual `refreshing` state — replaced by `usePRList` with built-in stale-while-revalidate
  and 60 s background refetch. `WorkspaceScreen` drops the parallel `useEffect` init; diff, settings,
  and cached review are now `useQuery` hooks. Query key factories live in
  `src/renderer/lib/queries.ts`. The streaming `review:run` pipeline stays manual.

- **Cross-file import context for consistency pass**: when the local repo cache is
  available, relative imports from changed files are resolved and fetched from the cache
  (capped at 20 % of the token budget). The consistency pass AI can now compare new code
  against the patterns established in imported-but-unchanged files — the scenario most
  likely to surface real consistency violations.

- **Local repo cache (Phase 6)**: Vigil now clones each reviewed repository to disk using
  `simple-git` and blobless partial clones (`--filter=blob:none`). After the first review of
  a repo, file content is read locally via `git show {sha}:{path}` instead of making one API
  call per changed file. Reduces rate-limit consumption, adds offline resilience, and
  unlocks cross-file context for future AI passes. Clones run in the background when a PR is
  opened; the API path remains active as a fallback until the clone completes. Cache eviction
  removes repos older than 30 days and enforces a 2 GB LRU cap. Requires git ≥ 2.22; the
  cache is automatically disabled and falls back to API calls on machines that don't meet this
  requirement.

- **Hunk collapse / expand**: clicking any `@@ ... @@` hunk header in the diff view
  collapses that hunk, showing only the header with a `· N lines` count hint and a
  rotating chevron. Click again to expand. Keyboard finding navigation (`n`/`p`)
  automatically uncollapses the hunk containing the focused finding before scrolling to it.

- **File filter for analysis pipeline**: binary and media assets (images, fonts, SVG, audio,
  video), auto-generated lockfiles (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, etc.),
  documentation (`.md`, `.mdx`, `.txt`), and minified/map output (`.min.js`, `.js.map`) are
  now excluded before any analysis pass runs. Reduces token usage and eliminates noise findings
  on non-reviewable files. Extends the existing test file exclusion.

- **PR Analysis tabs**: 6-lens tab bar above the workspace — Overview (pulse metrics, top
  findings, activity timeline), Diff (3-panel inline review), Silent risks (4-col regression
  table with evidence cells and detector legend), Semantic (numbered change cards with
  BEHAVIOR/SECURITY/REFACTOR badges, before/after code blocks, plain-English explanations,
  and risk notes), and Architecture (metrics strip, layer map with violation highlights,
  violations table). Tab key cycles lenses; `reviewed X ago` timestamp appears when
  analysis completes.

- **Developer preview mode** (`pnpm dev:mock`): launches Vigil with a fully mocked API —
  no GitHub connection required. Covers the complete flow: auth screen → sign-in → Review
  Queue (4 mock PRs across GitHub and Azure DevOps) → Review Workspace (payments-service
  #2847 with 8 findings). All 6 workspace tabs are populated with realistic content.

- **Review Workspace redesign**: 3-panel layout matching the Claude Design handoff — 240px file
  rail with risk dots and active teal accent rule, flex diff center with inline `vigil` findings
  expanded on click, and a 320px conversation panel (AI summary + per-finding challenge thread).
  Bottom strip with keyboard hints (`j`/`k` files, `n`/`p` findings, `m` approve) and
  Comment / Request changes / Approve verdict buttons that open a compact compose overlay.
  Diff backgrounds use the refined oklch palette from the design (`addBg`/`delBg`).

- **Review Workspace** (`src/renderer/features/workspace/WorkspaceScreen.tsx`): full PR review
  screen with a unified diff view (syntax-highlighted, hunk headers, old/new line numbers),
  inline `FindingDot` markers in the gutter, a scrollable findings list panel on the right sorted
  by severity, and a `FindingDetail` view (title, description, evidence, "Add to review" button).
  Auto-runs analysis on first open and serves cached results on return visits. Two-column layout
  (65% diff / 35% panel). Keyboard navigation: `j`/`k` to move through findings, `Enter` to open
  detail, `Escape` to return to list or queue, `a` to add focused finding to review draft.

- **ReviewDraft panel**: verdict buttons (Approve / Request Changes / Comment), freeform body
  textarea, queued inline comments with removal, and submit via `platform:submitReview`. Docked
  at the bottom of the right panel.

- **Review result cache** (`src/main/ai/ReviewCache.ts`): stores `ReviewResult` keyed by
  `headSha` as JSON in `userData/reviews/` with a 7-day TTL. Written after a successful
  `review:run`; read on workspace open before running analysis. Revisiting a PR is now instant.

- **Auto-refresh and manual refresh for Review Queue**: PRs refresh silently every 60 seconds
  (existing rows stay visible during background refresh). A refresh button with a spin animation
  appears in the titlebar; `r` keyboard shortcut also triggers a refresh.

- **Double-click to open PR**: clicking a row in the Review Queue selects it (single click);
  double-clicking opens the Review Workspace.

- **File logging transport** (`src/main/logger.ts`): `FileLogger` writes structured (`src/main/logger.ts`): `FileLogger` writes structured
  log lines to `app.getPath('logs')/vigil.log`, rotates at 5 MB (keeping one `.old`
  archive), defaults to `error` level overridable via `VIGIL_LOG_LEVEL`, and redacts
  fields whose names match `token|secret|key|password|pat` before writing. Replaces
  `ConsoleLogger` in the main process.

- **Settings screen** (`src/renderer/features/settings/`): AI provider selection (Anthropic / OpenAI),
  API key entry and removal per provider (stored in OS keychain), and per-account sign-out. Accessible
  via the gear icon in the Review Queue titlebar. Signing out the last connected account redirects to
  the Auth screen.
- **App-level navigation**: lightweight route state machine in `App.tsx` — `checking → auth → queue ↔ settings`.
  No router dependency.
- **Dock icon**: Vigil icon now appears in the macOS dock during development using `app.dock.setIcon()`
  with `assets/icons/1024x1024.png` on launch.

- **Silent Regression Detector** (`SilentRegressionAnalyzer`): a new diff-aware `CodeAnalyzer` that
  flags behavioral changes matching known high-risk patterns using "paired hunk analysis" — comparing
  adjacent removed→added blocks within hunks rather than scanning lines in isolation. Five detectors:
  (1) **Condition operator changes** — flags risky operator swaps (`>=` → `===`, `||` → `&&`, etc.)
  in conditional context when the surrounding code is structurally similar; severity `high`.
  (2) **Error handling removal/change** — flags removed `catch` blocks and `return null` changed to
  `throw` within catch context; severity `high`.
  (3) **Numeric constant changes** — flags number literal changes in lines containing sensitivity
  keywords (`timeout`, `retry`, `delay`, `backoff`, etc.); severity `medium`.
  (4) **Async pattern changes** — flags sequential `await` calls replaced by `Promise.all`,
  `Promise.allSettled`, `Promise.race`, or `Promise.any`; severity `medium`.
  (5) **Side effect introductions** — flags new `localStorage`, `sessionStorage`, `document.cookie`,
  `indexedDB`, and Node.js `fs.write*`/`fs.rm*` calls in added lines; severity `medium`.
  All detectors require multiple corroborating signals to minimize false positives. 23 new tests.
  Spec: `docs/specs/silent-regression-detector.md`.

- **Extended static analyzers** (`DebugArtifactsAnalyzer`, `TypeSafetyAnalyzer`, `ChangeClassifierAnalyzer`):
  three new diff-aware `CodeAnalyzer` implementations. Unlike the existing full-file analyzers, these
  operate on the diff itself — flagging only what the PR _introduced_, not pre-existing debt.
  `DebugArtifactsAnalyzer` flags newly added `console.*` calls (low), `debugger` statements (medium),
  and `TODO`/`FIXME`/`HACK`/`XXX` markers (info). `TypeSafetyAnalyzer` flags `as any` and double-cast
  patterns (medium), `@ts-ignore` (medium), `@ts-expect-error` (info), and non-null assertions (low)
  in added lines only. `ChangeClassifierAnalyzer` classifies each changed file as behavior/refactor/test/config
  using control-flow keyword heuristics and always emits a PR-level summary finding; when the PR title
  signals a refactor but behavior-change files exist, it also emits a medium-severity intent-mismatch finding.
  Documented limitation: the keyword heuristic misclassifies rename-heavy diffs as behavior changes.
  31 new tests. Spec: `docs/specs/static-analyzers-extended.md`.

- **Phase 3 — AI review pipeline**: hybrid static-analysis + AI review
  pipeline. Three `CodeAnalyzer` implementations run unconditionally
  (no API key required): `ComplexityAnalyzer` (cyclomatic complexity via
  TypeScript compiler API), `DuplicationAnalyzer` (sliding-window line
  hash), `SmellsAnalyzer` (long functions, deep nesting, too many
  parameters). Optional `AIProvider` layer adds three sequential AI
  passes (correctness, security, consistency) plus a summary pass that
  produces a 3–5 sentence summary and a 1–5 risk score. `AnthropicProvider`
  (`@anthropic-ai/sdk`) and `OpenAIProvider` (`openai`) both stream via
  `AsyncIterable<string>`. Context builder fetches file contents at HEAD
  via the new `PlatformProvider.getFileContent` method, respecting a
  160k-token budget. Prompt-injection defense: all untrusted PR content
  wrapped in XML tags with explicit system-prompt instructions.
  `pnpm review <pr-url>` is the Phase 3 exit criterion. 20 new tests.
- `PlatformProvider.getFileContent(session, ref, path, commitSha)`:
  fetches file content at a specific commit. `GitHubProvider` uses
  `octokit.rest.repos.getContent`; `AzureDevOpsProvider` uses the ADO
  items API with a raw text response.
- `PullRequest.headSha`: head commit SHA, populated by `getPullRequest`
  for both providers. Required by the context builder for file fetching.
- ADR-0007: Hybrid Review Pipeline — records the decision to run static
  analysis alongside (optional) AI, making the tool useful without an
  API key.
- ADR-0008: AIProvider Streaming via AsyncIterable — records the single
  `stream` method design over a `complete` + `stream` pair.

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

- **Static analyzers skip test files**: `*.test.*` and `*.spec.*` files are now filtered
  from the diff before running both static analyzers and AI passes. Test files generate
  noise (acceptable `console.log`, intentional `any` types, complex setup patterns).
- **Pass progress events**: `review:run` now emits a `review:pass` start event before each
  analyzer/AI pass and a `complete` event (with finding count) after. The workspace PassStrip
  transitions from ⟳ to ✓ N as each pass finishes rather than staying stuck.
- **GitHub PR query broadened**: changed from `review-requested:@me` to `involves:@me` so
  the Review Queue shows PRs you authored, are assigned to, are mentioned in, or are
  requested to review — not just the last category.

### Fixed

- **Review cache not hitting**: the PR list (GitHub search API) returns `headSha: ""`; the
  cache was written with the real headSha from `getPullRequest` but looked up with `""`.
  Fixed by using `diffResult.value.pr.headSha` from `platform:getPRWithDiff` as the cache key.
- **Findings not browsable**: the workspace right panel only showed a `FindingDetail` when a
  finding was already focused. Added a `FindingList` that shows all findings sorted by severity
  as the default panel state. Clicking any row opens its detail; Escape returns to the list.
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
