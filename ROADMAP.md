# Roadmap — Vigil

> **Status:** Living document. Last updated 2026-05-11.
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
- [ ] `README.md` (one-pager: what, why, status, install)
- [ ] License chosen and `LICENSE` file added (MIT or Apache 2.0 suggested)
- [ ] `.gitignore`, `.editorconfig`, `.nvmrc` (Node 24 LTS)
- [ ] `package.json` with `pnpm` declared, scripts skeleton
- [ ] TypeScript config (strict mode), ESLint, Prettier set up
- [ ] Vitest configured, one passing smoke test
- [ ] CI: GitHub Actions running typecheck + lint + tests on push
- [ ] First ADRs written:
  - [ ] ADR-0001: Electron over Tauri
  - [ ] ADR-0002: Platform Provider abstraction
  - [ ] ADR-0003: PKCE for desktop OAuth
  - [ ] ADR-0004: OS keychain for token storage
  - [ ] ADR-0005: Result type for error handling

**Exit criteria:** `pnpm install && pnpm test` works on a fresh clone.
CI is green. The repo looks professional at first glance.

---

## Phase 1 — Authentication working end-to-end

**Goal:** A user can sign in with both GitHub and Azure DevOps, and the
app remembers them across restarts.

This phase is deliberately not about the UI. Build the auth core first;
the UI comes in Phase 4.

- [ ] Spec: `docs/specs/auth-azure-devops.md`
- [ ] Spec: `docs/specs/auth-github.md`
- [ ] `Result<T, E>` type and helpers (`src/shared/result.ts`)
- [ ] `AuthProvider` interface
- [ ] `TokenStore` interface; keychain implementation via `keytar` or
      `@napi-rs/keyring`
- [ ] PKCE helpers (`pkce.ts`): verifier/challenge generation
- [ ] `AzureDevOpsAuthProvider` using MSAL Node + PKCE
- [ ] `GitHubAuthProvider` using OAuth Device Flow (no localhost
      listener needed; cleaner UX for CLI/desktop)
- [ ] `PATAuthProvider` fallback (manual token paste) for both platforms
- [ ] Token refresh logic with one automatic retry on 401
- [ ] Tests: unit tests for PKCE, mocked OAuth flows, contract tests
      ensuring every `AuthProvider` implementation behaves consistently

**Exit criteria:** A small Node script can call `signIn()` for either
provider, complete the OAuth flow in the user's browser, persist the
session in the keychain, and on second run skip the browser entirely.

---

## Phase 2 — Platform providers and PR fetching

**Goal:** Given an authenticated session, fetch a PR from GitHub or
Azure DevOps and normalize it into the internal model.

- [ ] Spec: `docs/specs/pr-fetch-and-normalize.md`
- [ ] Internal model types: `PullRequest`, `Diff`, `Hunk`, `Comment`,
      `Author`, `Repository`
- [ ] `PlatformProvider` interface
- [ ] `GitHubProvider`:
  - [ ] `listOpenPullRequests`
  - [ ] `getPullRequest` (with diff)
  - [ ] `getDiff` (unified diff + per-file structured form)
  - [ ] `postComment` (commit comment + PR comment paths)
  - [ ] `submitReview` (approve / request changes / comment)
- [ ] `AzureDevOpsProvider`:
  - [ ] Same surface, translating from Azure DevOps iterations and
        per-file changes into the unified `Diff` model
  - [ ] Org discovery flow (`/_apis/accounts`) for the first sign-in
- [ ] URL parser: given a PR URL from either platform, return a
      `PRRef` that the right provider can fetch
- [ ] Tests: contract tests both providers must pass; recorded HTTP
      fixtures for stability

**Exit criteria:** A CLI command — `your-tool fetch <pr-url>` — accepts
a URL from either platform and prints the normalized PR as JSON.

---

## Phase 3 — AI review pipeline

**Goal:** Given a normalized PR, produce structured review findings
using an LLM. CLI-only at this stage.

- [ ] Spec: `docs/specs/ai-review-pipeline.md`
- [ ] `AIProvider` interface (`complete` and `stream`)
- [ ] `AnthropicProvider` using `@anthropic-ai/sdk`
- [ ] `OpenAIProvider` using `openai` package
- [ ] BYOK key storage in keychain (per provider)
- [ ] Context builder:
  - [ ] Includes diff
  - [ ] Includes full content of changed files (truncated to budget)
  - [ ] Includes neighbouring code for changed regions
  - [ ] Token-budget aware; chunks by file when over budget
- [ ] Prompts as versioned files in `src/main/ai/prompts/`:
  - [ ] `correctness.md`
  - [ ] `security.md`
  - [ ] `consistency.md`
  - [ ] `summary.md`
- [ ] Review engine orchestrating the multi-pass pipeline
- [ ] `ReviewResult` model: findings (with file + line range + severity
      + evidence), summary, risk score
- [ ] Prompt-injection defense: untrusted-content delimiters, explicit
      instruction in system prompts
- [ ] Tests: golden tests against a small corpus of sample PRs (real
      ones, anonymized if needed)

**Exit criteria:** `your-tool review <pr-url>` produces a useful
review on a real PR in under 60 seconds for typical sizes.
Try it on at least 5 real PRs from different repos. If the findings
aren't better than CodeRabbit / Greptile, iterate on prompts before
moving on. This is the wedge.

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
- [ ] "Copy diagnostics" button for bug reports (redacted)
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
  *done*, including tests and changelog entries.
- **Each phase is shippable.** Even if the only "user" is you, treat
  the end of each phase as a release: tag it, update the changelog,
  write a short retrospective in the commit message of the tag.
- **Reorder when you learn.** If Phase 3 reveals that the platform
  abstraction is wrong, fix it before building on it. The roadmap
  serves the work, not the other way around.
- **Track progress in this file.** Tick items off as you complete them.
  When a phase finishes, add a one-line note: "Phase 1 complete on
  YYYY-MM-DD. Lessons: ..."
