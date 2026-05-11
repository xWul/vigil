# Changelog — Vigil

All notable changes to Vigil are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

### Changed

- ADR criteria tightened to a strict three-rule test
  (hard-to-reverse + surprising-without-context + real-trade-off),
  matching the discipline enforced by the `grill-with-docs` skill.
  This prevents ADR sprawl and keeps every record worth reading.
- `CLAUDE.md` updated with sections on domain language, `CONTEXT.md`,
  and skill usage.

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
