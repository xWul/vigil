# Vigil

A desktop application for AI-assisted code review.

> _Vigil (n.) — a period of keeping watch, especially through the night;
> staying purposefully awake and attentive._

Vigil is built for the era when developers using Claude Code, Cursor,
and Copilot are generating far more pull requests than humans can
carefully review. Existing tools (GitHub PR pages, Azure DevOps) were
built for a world of careful authorship and careful review. Vigil is
built for a world where the bottleneck is review, not authorship.

## Status

🚧 **Early development.** Not yet usable. See [`ROADMAP.md`](./ROADMAP.md)
for the planned development sequence.

## What Vigil aims to be

- **Review-first.** The home screen is a queue of pending pull
  requests, not a file tree.
- **AI-augmented, not AI-automated.** The LLM surfaces issues and
  provides context; the human approves, requests changes, or pushes
  back.
- **Multi-platform.** GitHub and Azure DevOps out of the box, with a
  clean abstraction for adding more.
- **Local-first.** Tokens in your OS keychain. No backend services
  to sign up for. BYOK (Bring Your Own Key) for AI providers.
- **Modern auth.** OAuth 2.0 with PKCE; personal access tokens as a
  fallback.

## Documentation

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — overall system design
- [`ROADMAP.md`](./ROADMAP.md) — phased development plan
- [`CHANGELOG.md`](./CHANGELOG.md) — what's changed
- [`CLAUDE.md`](./CLAUDE.md) — instructions for AI coding assistants
- [`docs/adr/`](./docs/adr/) — architectural decision records
- [`docs/specs/`](./docs/specs/) — per-feature specifications

## Development workflow

This project is built with Claude Code as a pair-programming partner.
All architectural decisions, abstractions, and design choices are
documented in [`docs/adr/`](./docs/adr/) and reviewed before commit.

## Tech stack

- Electron + Node.js 24 LTS (main process)
- React 19 + TypeScript 5.7+ (renderer)
- Vite 6 + electron-vite (build)
- Vitest 3 (tests)
- pnpm (package manager)

## License

Apache 2.0 — see [LICENSE](./LICENSE).
