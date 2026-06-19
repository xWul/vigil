# Changelog — Vigil

All notable changes to Vigil are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **PR comment threads**: existing review threads from GitHub and Azure DevOps now appear
  inline in the diff, anchored to their source line. Threads are collapsible, show all
  comments with relative timestamps, and accept immediate replies. Findings can be queued
  as pending inline comments; freeform line comments are also supported. All pending
  comments submit alongside the review verdict. Press `v` to show resolved threads,
  `R` to refresh from the platform.

- **Analysis loader**: opening a PR now shows shimmer placeholders in the Overview tab
  while the diff loads, and a thin progress bar under the tab strip throughout the
  analysis pipeline. The bar is indeterminate until the first pass fires, then tracks
  pass completion in real time.

- **Multi-language static analysis**: complexity, code smells, regression, and debug-artifact
  analysis now cover Java, Python, C#, Go, and Ruby in addition to TypeScript/JavaScript.
  Python PRs also receive cross-file context enrichment (imported modules resolved and
  summarised) on par with TypeScript. Java and Python symbol extraction reduces token cost
  for cross-file context.

- **Windows release builds**: a GitHub Actions `release.yml` workflow now builds macOS
  (`.dmg`) and Windows (`.exe`) artifacts in parallel on every `v*` tag push and publishes
  them to the GitHub Release automatically.

### Security

- Log redaction now covers nested objects and credentials embedded in strings (URLs, Bearer headers).

### Fixed

- **Azure DevOps diff hunks**: the AI review pipeline now receives full line-level diff data
  for Azure DevOps pull requests. Previously, `getDiff` returned file names and statuses
  only (hunks were empty), so the LLM and static analyzers had no changed-line context.
  Both file versions are now fetched at their respective merge commits and diffed locally
  using the `diff` package.

## [0.1.0] - 2026-05-19

### Added

- **Auto-update**: Vigil now checks for updates automatically on launch (5 s after startup,
  packaged builds only). Updates are downloaded silently in the background; the Settings
  screen shows current version, download progress, and a "Restart to install" button when
  a new version is ready. Uses `electron-updater` against GitHub Releases (`xWul/vigil`).
  GitHub publish config added to `electron-builder`.

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

- **Configurable analyzer settings**: every static analyzer parameter is now
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

- **First-run onboarding nudge**: the Review Queue now shows a persistent amber banner below
  the header when no AI provider is configured (`aiProvider` is null or the selected
  provider has no key). The banner links directly to Settings. Disappears automatically once
  a key is saved.

- **Copy diagnostics**: Settings → Diagnostics section → "Copy diagnostics" button reads the
  application log (`vigil.log` + `.old` archive), applies redaction of inline sensitive values
  (tokens, secrets, keys, passwords), and writes the result to the clipboard. Button shows
  "Copied!" feedback for 2 seconds. Adds `app:copyDiagnostics` IPC channel.

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

- **Re-run review**: a "Re-run review" button appears in the workspace bottom strip once
  analysis completes. Clicking it invalidates the cached result for the current head SHA,
  resets all findings and pass state, and re-runs the full pipeline in the background. The
  "Analyzing" strip appears immediately — no gap between clicking and the first pass event.

- **Diff skeleton loader**: the workspace now shows a pulsing animated skeleton while the
  diff is loading, replacing the plain "Loading diff…" text.

- **TanStack Query for IPC data fetching** (ADR-0011): `@tanstack/react-query` adopted for
  all request/response IPC calls in the renderer. `ReviewQueue` drops the `loadKey` counter,
  `mounted` flags, and manual `refreshing` state — replaced by `usePRList` with built-in
  stale-while-revalidate and 60 s background refetch. `WorkspaceScreen` drops the parallel
  `useEffect` init; diff, settings, and cached review are now `useQuery` hooks. Query key
  factories live in `src/renderer/lib/queries.ts`. The streaming `review:run` pipeline
  stays manual.

- **Cross-file import context for consistency pass**: when the local repo cache is available,
  relative imports from changed files are resolved and fetched from the cache (capped at 20%
  of the token budget). The consistency pass AI can now compare new code against the patterns
  established in imported-but-unchanged files.

- **Local repo cache (Phase 6)**: Vigil now clones each reviewed repository to disk using
  `simple-git` and blobless partial clones (`--filter=blob:none`). After the first review of
  a repo, file content is read locally via `git show {sha}:{path}` instead of making one API
  call per changed file. Reduces rate-limit consumption, adds offline resilience, and unlocks
  cross-file context for AI passes. Clones run in the background when a PR is opened; the API
  path remains active as a fallback until the clone completes. Cache eviction removes repos
  older than 30 days and enforces a 2 GB LRU cap. Requires git ≥ 2.22; the cache
  automatically disables and falls back to API calls on machines that don't meet this
  requirement.

- **Hunk collapse / expand**: clicking any `@@ ... @@` hunk header in the diff view collapses
  that hunk, showing only the header with a `· N lines` count hint and a rotating chevron.
  Click again to expand. Keyboard finding navigation (`n`/`p`) automatically uncollapses the
  hunk containing the focused finding before scrolling to it.

- **File filter for analysis pipeline**: binary and media assets, auto-generated lockfiles,
  documentation, and minified/map output are excluded before any analysis pass runs. Reduces
  token usage and eliminates noise findings on non-reviewable files.

- **PR Analysis tabs**: 6-lens tab bar — Overview (pulse metrics, top findings, activity
  timeline), Diff (3-panel inline review), Silent risks (regression table with evidence cells
  and detector legend), Semantic (numbered change cards with BEHAVIOR/SECURITY/REFACTOR
  badges, before/after code blocks, plain-English explanations, and risk notes), and
  Architecture (metrics strip, circular dependency findings). Tab key cycles lenses.

- **Developer preview mode** (`pnpm dev:mock`): launches Vigil with a fully mocked API — no
  GitHub connection required. Covers the complete flow: auth screen → sign-in → Review Queue
  (4 mock PRs across GitHub and Azure DevOps) → Review Workspace with 8 findings. All
  workspace tabs are populated with realistic content.

- **Review Workspace redesign**: 3-panel layout — 240px file rail with risk dots and active
  teal accent rule, flex diff center with inline findings expanded on click, and a 320px
  conversation panel (AI summary + per-finding challenge thread). Bottom strip with keyboard
  hints and Comment / Request changes / Approve verdict buttons.

- **Review result cache**: stores `ReviewResult` keyed by `headSha` as JSON in
  `userData/reviews/` with a 7-day TTL. Written after a successful `review:run`; read on
  workspace open before running analysis. Revisiting a PR is instant.

- **Auto-refresh and manual refresh for Review Queue**: PRs refresh silently every 60 seconds.
  A refresh button with a spin animation appears in the titlebar; `r` keyboard shortcut also
  triggers a refresh.

- **Silent Regression Detector** (`SilentRegressionAnalyzer`): a new diff-aware analyzer that
  flags behavioral changes matching known high-risk patterns using "paired hunk analysis". Five
  detectors: condition operator changes (high), error handling removal (high), numeric constant
  changes in sensitivity-keyword context (medium), async pattern changes (medium), and side
  effect introductions (medium). 23 tests. Spec: `docs/specs/silent-regression-detector.md`.

- **Extended static analyzers** (`DebugArtifactsAnalyzer`, `TypeSafetyAnalyzer`,
  `ChangeClassifierAnalyzer`): three new diff-aware analyzers that flag only what the PR
  introduced. `DebugArtifactsAnalyzer` flags `console.*`, `debugger`, and TODO markers.
  `TypeSafetyAnalyzer` flags `as any`, `@ts-ignore`, and non-null assertions in added lines.
  `ChangeClassifierAnalyzer` classifies each changed file and emits a PR-level summary; emits
  an intent-mismatch finding when the PR title signals a refactor but behavior-change files
  exist. 31 tests. Spec: `docs/specs/static-analyzers-extended.md`.

- **AI review pipeline (Phase 3)**: three `CodeAnalyzer` implementations run without an API
  key (`ComplexityAnalyzer`, `DuplicationAnalyzer`, `SmellsAnalyzer`). Optional AI layer adds
  correctness, security, and consistency passes plus a summary with a 1–5 risk score.
  `AnthropicProvider` and `OpenAIProvider` both stream via `AsyncIterable<string>`. Context
  builder fetches file content at HEAD, respecting a 160k-token budget. Prompt-injection
  defense: all PR content wrapped in XML tags. ADR-0007, ADR-0008.

- **Platform providers and PR fetching (Phase 2)**: `GitHubProvider` and
  `AzureDevOpsProvider` fetch PRs, diffs, and file content; post comments; and submit
  reviews. `parsePRUrl` normalizes GitHub and Azure DevOps URLs into a typed `PRRef`.
  47 tests using MSW; shared contract tests run against both providers. ADR-0002.

- **Authentication (Phase 1)**: GitHub OAuth Device Flow, Azure DevOps PKCE Authorization
  Code, and PAT fallback for both platforms. Token refresh with one automatic retry on 401.
  Tokens stored in the OS keychain via `@napi-rs/keyring`. ADR-0003, ADR-0004.

- **File logging transport**: `FileLogger` writes structured log lines to
  `app.getPath('logs')/vigil.log`, rotates at 5 MB (keeping one `.old` archive), defaults to
  `error` level overridable via `VIGIL_LOG_LEVEL`, and redacts fields whose names match
  `token|secret|key|password|pat` before writing. ADR-0006.

- **Settings screen**: AI provider selection (Anthropic / OpenAI), API key entry and removal
  per provider (stored in OS keychain), and per-account sign-out. Accessible via the gear
  icon in the Review Queue titlebar.

### Changed

- **Static analyzer accuracy improvements** — five targeted fixes:

  - `ComplexityAnalyzer` no longer inflates the outer function's cyclomatic complexity score
    with branches that belong to nested inner functions. Each function is now measured
    independently.
  - `ComplexityAnalyzer` and `SmellsAnalyzer` now scope findings to functions that overlap
    the changed diff hunks. Unrelated pre-existing smells in modified files no longer appear.
  - `SilentRegressionAnalyzer` "catch block removed" finding now reports `medium` severity
    when the removed catch lines are accompanied by replacement code (likely a refactor),
    reserving `high` for pure catch deletions with no replacement.
  - `DuplicationAnalyzer` no longer flags files that share common `import`/`export`
    declarations as duplicated code. Module-level structural lines are filtered.
  - `ChangeClassifierAnalyzer` now classifies deleted source files as `refactor` rather than
    `behavior`. Deleting code removes behavior — it does not introduce it.

- **Static analyzers skip test files**: `*.test.*` and `*.spec.*` files are filtered from
  the diff before running static analyzers and AI passes.

- **Pass progress events**: `review:run` now emits a `review:pass` start event before each
  analyzer/AI pass and a `complete` event (with finding count) after. The workspace PassStrip
  transitions from ⟳ to ✓ N as each pass finishes.

- **GitHub PR query broadened**: changed from `review-requested:@me` to `involves:@me` so
  the Review Queue shows PRs you authored, are assigned to, are mentioned in, or are
  requested to review.

### Fixed

- **Review cache not hitting**: the PR list returns `headSha: ""`; the cache was written with
  the real headSha but looked up with `""`. Fixed by using the headSha from
  `platform:getPRWithDiff` as the cache key.

- **Findings not browsable**: the workspace right panel only showed a `FindingDetail` when a
  finding was already focused. Added a `FindingList` as the default panel state.

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
