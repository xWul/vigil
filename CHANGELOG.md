# Changelog — Vigil

All notable changes to Vigil are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
