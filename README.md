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

**Working, pre-release.** The core review loop is complete and functional.
Auth, PR queue, diff view, static analysis, AI passes, and review submission
all work end-to-end. Packaging and distribution are the next milestone.

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
- **Architecture tab** — detects circular import dependencies among files
  touched by the PR; no configuration required
- **ChallengeThread** — per-finding AI conversation scoped to the relevant
  diff hunk; stream responses inline
- **Review submission** — approve, request changes, or comment with queued
  inline comments; submits as a single platform review
- **Local repo cache** — blobless partial git clones for faster file fetches
  and cross-file context for the consistency pass

## Principles

- **Review-first.** The home screen is a queue, not a file tree.
- **AI-augmented, not AI-automated.** The LLM surfaces issues; the human
  decides.
- **Multi-platform.** GitHub and Azure DevOps. Clean abstraction for more.
- **Local-first.** Tokens in your OS keychain. No backend. BYOK for AI.
- **Keyboard-first.** Every action reachable without a mouse.

## Getting started

### Prerequisites

- **Node.js 24 LTS** — `node --version` should show `v24.x`
- **pnpm** — `npm install -g pnpm`
- **git ≥ 2.22** — required by the local repo cache (blobless clones)

### Install dependencies

```bash
pnpm install
```

### Run in development mode

```bash
pnpm dev
```

The app opens. From here:

1. **Connect an account** — Settings → sign in with GitHub or Azure DevOps
2. **Configure an AI provider** — Settings → paste an Anthropic or OpenAI API
   key (optional; static analysis works without one)
3. **Open a PR** — the queue lists open PRs assigned to or authored by you;
   double-click any row to open the workspace

### Mock mode (no GitHub account needed)

```bash
pnpm dev:mock
```

Runs the app against a mock API that covers the full auth → queue → workspace
flow with realistic data. All workspace tabs are populated. Useful for UI
development and exploration.

### Other commands

```bash
pnpm test          # run all tests
pnpm typecheck     # TypeScript strict check
pnpm lint          # ESLint
pnpm check         # typecheck + lint + format + tests in one shot
pnpm lint:fix      # auto-fix lint issues
pnpm format        # Prettier
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
- [`docs/adr/`](./docs/adr/) — architectural decision records (11 ADRs)
- [`docs/specs/`](./docs/specs/) — per-feature specifications

## License

Apache 2.0 — see [LICENSE](./LICENSE).
