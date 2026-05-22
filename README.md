# Vigil

A desktop application for AI-assisted code review.

> _Vigil (n.) — a period of keeping watch, especially through the night;
> staying purposefully awake and attentive._

Vigil is built for the era when developers using Claude Code, Cursor, and
Copilot are generating far more pull requests than humans can carefully
review. Existing tools (GitHub PR pages, Azure DevOps) were built for a
world of careful authorship and careful review. Vigil is built for a world
where the bottleneck is review, not authorship.

## Status

**v0.1.0 — first public release.** macOS only. The core review loop is
complete: auth, queue, diff view, eight static analysis passes, three AI
review passes, and review submission all work end-to-end.

## Install

Download the latest `.dmg` from [Releases](https://github.com/xWul/vigil/releases),
open it, and drag Vigil to your Applications folder.

**Requirements:**

- macOS 13 Ventura or later
- git ≥ 2.22 (check with `git --version`; ships on all recent Macs)
- An Anthropic or OpenAI API key for AI passes (optional — static analysis
  works without one)

## First run

1. **Connect an account** — open Settings (⌘,) and sign in with GitHub or
   Azure DevOps. Vigil uses OAuth; no password is stored.
2. **Add an AI key** (optional) — Settings → AI Provider → paste an Anthropic
   or OpenAI key. Vigil stores it in the macOS keychain.
3. **Open a PR** — the Review Queue lists open PRs assigned to or involving
   you. Double-click any row to open the workspace.

Once a PR is open:

- **Static analysis** runs immediately — no AI key needed. Eight passes cover
  complexity, duplication, code smells, debug artifacts, type safety, change
  classification, silent regressions, and circular imports.
- **AI passes** stream in if a key is configured: correctness, security, and
  consistency, followed by a 1–5 risk score summary.
- Navigate findings with `j` / `k`, jump between files with `n` / `p`, press
  `m` to approve, `?` for the full shortcut list.
- Submit your review (approve / request changes / comment) from the verdict
  buttons in the bottom strip.

## What Vigil does

- **Review Queue** — a prioritized list of open PRs across connected accounts,
  with risk scores from cached reviews, search, sort, and keyboard navigation
- **Diff view** — syntax-highlighted unified diff with collapsible hunks and
  inline finding markers anchored to affected lines
- **Static analysis** — eight local passes that run instantly without an AI
  key: complexity, duplication, smells, debug artifacts, type safety, change
  classification, silent regressions, and circular dependency detection
- **AI review** — three LLM passes (correctness, security, consistency) plus
  a summary with a 1–5 risk score; streamed to the UI as findings arrive
- **Semantic tab** — behavioral regression findings mapped to before/after
  code blocks with plain-English risk notes
- **Architecture tab** — detects circular import dependencies among files
  touched by the PR; no configuration required
- **Challenge thread** — per-finding AI conversation scoped to the relevant
  diff hunk; responses stream inline
- **Review submission** — approve, request changes, or comment with queued
  inline comments; submits as a single platform review
- **Local repo cache** — blobless partial git clones for faster file fetches
  and cross-file context for the consistency pass
- **Configurable analyzers** — tune every threshold and toggle per repository
  via the settings overlay (`,`) or a `.vigilrc` file in the repo root

## Principles

- **Review-first.** The home screen is a queue, not a file tree.
- **AI-augmented, not AI-automated.** The LLM surfaces issues; the human
  decides.
- **Multi-platform.** GitHub and Azure DevOps. Clean abstraction for more.
- **Local-first.** Tokens in your OS keychain. No backend. BYOK for AI.
- **Keyboard-first.** Every action reachable without a mouse.

## Build from source

### Prerequisites

- **Node.js 24 LTS** — `node --version` should show `v24.x`
- **pnpm** — `npm install -g pnpm`
- **git ≥ 2.22** — required by the local repo cache (blobless clones)

### Install and run

```bash
pnpm install
pnpm dev        # development mode
pnpm dev:mock   # mock mode — no GitHub account needed
```

**Mock mode** runs the app against a fully mocked API covering the complete
auth → queue → workspace flow with realistic data. All workspace tabs are
populated. Useful for exploring Vigil without connecting a real account.

### Other commands

```bash
pnpm test          # run all tests
pnpm typecheck     # TypeScript strict check
pnpm lint          # ESLint
pnpm check         # typecheck + lint + format + tests in one shot
pnpm dist          # build distributable (requires code signing for macOS)
```

## Project layout

```
src/main/auth/          OAuth flows, token storage
src/main/platforms/     GitHub / Azure DevOps providers
src/main/git/           local repo cache (simple-git, blobless clones)
src/main/ai/            review pipeline, analyzers, LLM providers
src/main/ipc/           typed IPC handlers
src/renderer/           React UI (presentation only)
src/shared/             types and pure logic shared by both processes
docs/adr/               architectural decision records
docs/specs/             per-feature specifications
```

## Tech stack

| Layer           | Technology                      |
| --------------- | ------------------------------- |
| Desktop shell   | Electron                        |
| Main process    | Node.js 24 LTS, TypeScript 5.7+ |
| Renderer        | React 19, TypeScript 5.7+       |
| Build           | Vite 6, electron-vite           |
| Tests           | Vitest 3                        |
| Package manager | pnpm                            |
| AI SDKs         | `@anthropic-ai/sdk`, `openai`   |
| Git             | `simple-git`                    |
| Data fetching   | TanStack Query v5               |

## Documentation

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — system design and process boundary
- [`CONTEXT.md`](./CONTEXT.md) — domain glossary
- [`ROADMAP.md`](./ROADMAP.md) — phased development plan and current status
- [`CHANGELOG.md`](./CHANGELOG.md) — what's changed
- [`docs/adr/`](./docs/adr/) — architectural decision records (12 ADRs)
- [`docs/specs/`](./docs/specs/) — per-feature specifications

## License

Apache 2.0 — see [LICENSE](./LICENSE).
