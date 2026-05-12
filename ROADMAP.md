# Roadmap — Vigil

> **Status:** Living document. Last updated 2026-05-11. Phase 1 in progress.
> **Purpose:** Sequence the work on Vigil so each milestone is shippable
> and teaches something concrete. Items here are intentions, not
> contracts — reorder freely as the project teaches us what matters.

The roadmap is organized into phases. Each phase produces a working,
demonstrable artifact. Don't skip phases; the value is in the sequence,
not the destination.

---

## Phase 0 — Foundations

**Goal:** A repo that's ready for serious work.

- [x] `ARCHITECTURE.md` written
- [x] `CLAUDE.md` written
- [x] `CHANGELOG.md` initialised
- [x] `ROADMAP.md` (this file)
- [x] `README.md` (one-pager: what, why, status, install)
- [x] License chosen and `LICENSE` file added (MIT or Apache 2.0 suggested)
- [x] `.gitignore`, `.editorconfig`, `.nvmrc` (Node 24 LTS)
- [x] `package.json` with `pnpm` declared, scripts skeleton
- [x] TypeScript config (strict mode), ESLint, Prettier set up
- [x] Vitest configured, one passing smoke test
- [x] CI: GitHub Actions running typecheck + lint + tests on push
- [ ] First ADRs written:
  - [x] ADR-0001: Electron over Tauri
  - [x] ADR-0002: Platform Provider abstraction
  - [x] ADR-0003: PKCE for desktop OAuth
  - [x] ADR-0004: OS keychain for token storage
  - [x] ADR-0005: Result type for error handling

**Exit criteria:** `pnpm install && pnpm test` works on a fresh clone.
CI is green. The repo looks professional at first glance.

---

## Phase 1 — Authentication working end-to-end

**Goal:** A user can sign in with both GitHub and Azure DevOps, and the
app remembers them across restarts.

This phase is deliberately not about the UI. Build the auth core first;
the UI comes in Phase 4.

- [x] Spec: `docs/specs/auth-azure-devops.md`
- [x] Spec: `docs/specs/auth-github.md`
- [x] `Result<T, E>` type and helpers (`src/shared/result.ts`)
- [x] `AuthProvider` interface
- [x] `TokenStore` interface; keychain implementation via `@napi-rs/keyring`
- [x] PKCE helpers (`pkce.ts`): verifier/challenge generation
- [x] `AzureDevOpsAuthProvider` using MSAL Node + PKCE
- [x] `GitHubAuthProvider` using OAuth Device Flow (no localhost
      listener needed; cleaner UX for CLI/desktop)
- [x] `PATAuthProvider` fallback (manual token paste) for both platforms
- [x] Token refresh logic with one automatic retry on 401
- [x] Tests: unit tests for PKCE, mocked OAuth flows, contract test
      framework (`authProviderContract.ts`) used by `AzureDevOpsAuthProvider`;
      extended to cover `GitHubAuthProvider` when implemented

**Exit criteria:** A small Node script can call `signIn()` for either
provider, complete the OAuth flow in the user's browser, persist the
session in the keychain, and on second run skip the browser entirely.

---

## Phase 1.5 — Logger interface (pre-Electron)

**Goal:** Establish the `Logger` abstraction before Phase 2 adds
network calls. All modules accept a logger by injection from day one;
no constructor signatures need retrofitting later. The concrete
Electron transport is wired up in Phase 4.

This phase produces no user-visible feature and no dependency on
Electron. Its value is that Phase 2 and Phase 3 code is observable
from the moment it is written — console output during development,
file output once Electron exists.

- [x] ADR-0006: observability strategy (split interface/transport)
- [x] Spec: `docs/specs/observability.md`
- [x] `Logger` interface + `NoopLogger` + `ConsoleLogger`
      (`src/shared/logger.ts`) — no Electron dependency
- [x] Instrument Phase 1 auth flows with log calls (accepting `Logger`
      as an optional constructor parameter defaulting to `NoopLogger`)

**Exit criteria:** `VIGIL_LOG_LEVEL=debug pnpm auth:ado` prints
structured log entries to the console. All 86 existing tests pass with
`NoopLogger` injected (no new test changes required).

---

## Phase 2 — Platform providers and PR fetching

**Goal:** Given an authenticated session, fetch a PR from GitHub or
Azure DevOps and normalize it into the internal model.

- [x] Spec: `docs/specs/pr-fetch-and-normalize.md`
- [x] ADR-0002: Platform Provider abstraction
- [x] Internal model types: `PRRef`, `PullRequest`, `Diff`, `FileDiff`,
      `Hunk`, `DiffLine`, `Comment`, `Author`, `PlatformError`,
      `NewComment`, `NewReview` (`src/main/platforms/model/`)
- [x] `PlatformProvider` interface
- [x] `GitHubProvider` (via `@octokit/rest`):
  - [x] `listOpenPullRequests` (assignment-scoped via search API)
  - [x] `getPullRequest`
  - [x] `getDiff` (unified diff parsed into structured `FileDiff[]`)
  - [x] `postComment` (PR-level and inline)
  - [x] `submitReview` (approve / request changes / comment)
- [x] `AzureDevOpsProvider` (raw `fetch`):
  - [x] `listOpenPullRequests`
  - [x] `getPullRequest`
  - [x] `getDiff` (file list from iterations/changes; hunks deferred to Phase 3)
  - [x] `postComment`
  - [x] `submitReview`
  - [x] `discoverOrgs` standalone utility
- [x] URL parser: handles GitHub, dev.azure.com, and legacy visualstudio.com URLs
- [x] Tests: MSW-backed, contract tests run against both providers (47 new tests)
- [x] Logging: sign-in/refresh events logged per Phase 1.5 pattern

**Exit criteria:** `pnpm fetch-pr <pr-url>` accepts a URL from either
platform and prints the normalized PR and diff as JSON.

---

## Phase 3 — AI review pipeline

**Goal:** Given a normalized PR, produce structured review findings
using an LLM. CLI-only at this stage.

- [x] Spec: `docs/specs/ai-review-pipeline.md`
- [x] ADR-0007: Hybrid review pipeline (static analysis + optional AI)
- [x] ADR-0008: AIProvider streaming via AsyncIterable
- [x] `AIProvider` interface (`stream` returning `AsyncIterable<string>`)
- [x] `AnthropicProvider` using `@anthropic-ai/sdk`
- [x] `OpenAIProvider` using `openai` package
- [x] BYOK: API keys read from env vars for Phase 3 (`ANTHROPIC_API_KEY`,
      `OPENAI_API_KEY`); durable keychain storage deferred to Phase 4
- [x] `CodeAnalyzer` interface and three implementations:
  - [x] `ComplexityAnalyzer` (cyclomatic complexity via TS compiler API)
  - [x] `DuplicationAnalyzer` (line-hash copy-paste detection)
  - [x] `SmellsAnalyzer` (long functions, deep nesting, long param lists)
- [x] Context builder (`buildReviewContext`):
  - [x] Fetches PR metadata + diff
  - [x] Fetches full file content at HEAD per changed file
  - [x] Token-budget aware; drops whole files when over budget (most-changed first)
- [x] `getFileContent` added to `PlatformProvider`; `headSha` added to `PullRequest`
- [x] Prompts as versioned files in `src/main/ai/prompts/`:
  - [x] `correctness.md`
  - [x] `security.md`
  - [x] `consistency.md`
  - [x] `summary.md`
- [x] Review engine (`runReview`): static passes in parallel, AI passes
      sequential; summary pass receives prior findings only
- [x] `ReviewResult` model: `Finding[]` (severity, title, description,
      evidence, file, lines, pass, source), summary, riskScore
- [x] Prompt-injection defense: XML tag delimiters, explicit system
      prompt instruction
- [x] `collectStream` helper for buffering `AsyncIterable<string>`
- [ ] Tests: golden tests gated behind `VIGIL_RUN_GOLDEN_TESTS=1`;
      3 fixtures (security bug, logic bug, clean trivial)
- [x] Logging: AI calls at `info` (model, latency); parse errors at
      `warn`; full prompt/completion at `debug` opt-in only

**Exit criteria:** `pnpm review <pr-url>` produces a useful review on
a real PR in under 60 seconds for typical sizes. Try on at least 5
real PRs from different repos. If AI findings aren't meaningfully
better than noise, iterate on prompts before moving on. This is the wedge.

---

## Phase 4 — Electron shell

**Goal:** Wrap everything built so far in a desktop app with a real UI.

- [ ] ADR: IPC contract pattern
- [ ] Spec: `docs/specs/ipc-contract.md`
- [ ] Electron main + renderer scaffolded with electron-vite
- [ ] Typed IPC contract (`src/shared/ipc-contract.ts`)
- [ ] Main process exposes auth, platform, and AI capabilities via IPC
- [ ] Renderer API client (`src/renderer/api.ts`) mirroring the contract
- [ ] React Router or similar for navigation
- [ ] State management (Zustand recommended for simplicity)
- [ ] Auth screen: pick provider, run sign-in flow
- [ ] Settings screen: AI provider, API key entry, default org
- [ ] Smoke test: end-to-end Playwright test that builds the app and
      runs a fake auth flow
- [ ] Logging transport (`src/main/logger.ts`) backed by `electron-log`:
  - [ ] File transport to `app.getPath('logs')/vigil.log`
  - [ ] Rotating at 5 MB (keeps one archive)
  - [ ] Default level: `error`; overridable via `VIGIL_LOG_LEVEL`
  - [ ] Redaction: fields matching `token|secret|key|password|pat`
        replaced with `[redacted]` before any transport sees the message
  - [ ] Inject into all providers at app startup (replaces `ConsoleLogger`)
- [ ] Logging: IPC handler calls logged at `debug`; IPC errors logged
      at `error`; Settings screen exposes the log level toggle and
      an "Open log file" button

**Exit criteria:** A real desktop app launches. Users can sign in.
Settings persist. No business logic in the renderer.

---

## Phase 5 — Review Queue and Review Workspace

**Goal:** The two screens that define the product.

- [ ] Spec: `docs/specs/review-queue.md`
- [ ] Spec: `docs/specs/review-workspace.md`
- [ ] Review Queue:
  - [ ] List of pending PRs across connected platforms
  - [ ] Per-PR metadata: title, author, age, risk indicator, summary
  - [ ] Sort/filter (by risk, age, platform)
  - [ ] Keyboard navigation
- [ ] Review Workspace:
  - [ ] Diff view (syntax-highlighted, hunk-collapsible)
  - [ ] Inline AI findings attached to relevant lines
  - [ ] Finding detail panel: severity, evidence, "challenge this"
  - [ ] AI conversation thread for the PR (streaming responses)
  - [ ] Review actions (approve, request changes, comment)
  - [ ] Keyboard-first navigation between hunks and findings
- [ ] Streaming UI: review runs incrementally; findings appear as
      passes complete

**Exit criteria:** The app feels like a review tool, not a generic
IDE with diffs bolted on. A reviewer can complete a real review
faster than in the GitHub web UI for a non-trivial PR.

---

## Phase 6 — Local repo cache and deep context

**Goal:** Use full repo context to make findings smarter.

- [ ] ADR: local repo cache strategy
- [ ] Spec: `docs/specs/repo-cache.md`
- [ ] Repo clone-on-demand into a managed cache directory
- [ ] `git fetch` on PR open if the cache is stale
- [ ] Eviction policy (LRU, size cap)
- [ ] Consistency pass uses cache for "find similar code" prompts
- [ ] Optional: tree-sitter integration for symbol-aware context

**Exit criteria:** Reviewing a 500-line PR in a 50k-line codebase
surfaces at least one finding that requires cross-file context — and
the AI's evidence references the relevant file by name.

---

## Phase 7 — Polish, packaging, distribution

**Goal:** A v0.1 release that someone other than you can install and use.

- [ ] App icons, splash screen, dock/tray
- [ ] `electron-builder` configured for macOS / Windows / Linux
- [ ] Code signing (macOS at minimum if you have an Apple Developer account)
- [ ] First-run onboarding flow
- [ ] "Copy diagnostics" button: reads the log file produced by the
      Phase 1.5 logger, applies the same redaction rules, and copies
      the result to the clipboard for pasting into a GitHub issue
- [ ] README polished: screenshots, install instructions, how-to
- [ ] Demo video or animated GIF
- [ ] First GitHub Release: `v0.1.0` with installers
- [ ] Tagged version in `CHANGELOG.md`

**Exit criteria:** Someone clones the repo, follows the README, and
gets a working review on a PR in under 10 minutes.

---

## Phase 8 — Tell the world

**Goal:** Treat shipping as part of the project. Portfolio value comes
from people seeing the work.

- [ ] Blog post: "I built a code review IDE for the AI era — here's
      what I learned"
- [ ] Blog post (technical): "Designing the platform abstraction for
      multi-provider code review"
- [ ] Blog post (technical): "OAuth 2.0 with PKCE in Electron, the right
      way"
- [ ] Submit to Hacker News (Show HN), Lobsters, relevant subreddits
- [ ] LinkedIn post linking the repo and blog
- [ ] Add the project to your CV with a one-line description and link

**Exit criteria:** The project has external readers, stars, and at
least one piece of unsolicited feedback from a stranger.

---

## Stretch goals (not committed)

These are explicitly out of scope until everything above ships:

- GitLab and Bitbucket providers
- Inline AI suggestions applied as commits
- Recorded voice + cursor review walkthroughs
- Semantic diff (meaning-level, not text-level)
- Repository-wide embedding search
- Team features (shared rules, organisation-level metrics)
- Self-hosted analytics for teams (potential commercial layer)
- Web-hosted version
- Mobile companion app

Anything here is a candidate for an RFC if it becomes relevant.

---

## How to use this roadmap

- **One phase at a time.** Don't start Phase 2 before Phase 1 is
  _done_, including tests and changelog entries.
- **Each phase is shippable.** Even if the only "user" is you, treat
  the end of each phase as a release: tag it, update the changelog,
  write a short retrospective in the commit message of the tag.
- **Reorder when you learn.** If Phase 3 reveals that the platform
  abstraction is wrong, fix it before building on it. The roadmap
  serves the work, not the other way around.
- **Track progress in this file.** Tick items off as you complete them.
  When a phase finishes, add a one-line note: "Phase 1 complete on
  YYYY-MM-DD. Lessons: ..."
