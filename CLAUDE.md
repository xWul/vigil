# Claude Code Instructions — Vigil

> Read this file before making any non-trivial change to Vigil.
> It encodes the conventions, architecture, and workflow expectations
> that should be followed across all sessions.

## Project context

**Vigil** is an Electron desktop application for AI-assisted code
review. The name reflects the product's purpose — a vigil is something
you _keep_, deliberately and patiently. The target user is a senior
engineer who reviews many pull requests per day, increasingly authored
with AI assistance, and wants an AI-augmented review experience.

Bring Your Own Key (BYOK) for AI providers. No backend services we operate.
Local-first. Tokens in the OS keychain.

Before making non-trivial changes:

1. Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the big picture.
2. Check [`docs/adr/`](./docs/adr/) for relevant decisions.
3. Check [`docs/specs/`](./docs/specs/) for feature-level specifications.
4. If introducing a new pattern not covered above, propose an ADR first.

## Stack

- **Language:** TypeScript 5.7+, strict mode. No `any`. No `as` casts
  except at well-justified boundaries.
- **Runtime:** Node.js 24 LTS for main process.
- **UI:** React 19.2.6+ for renderer.
- **Build:** Vite 6 + electron-vite.
- **Tests:** Vitest 3, co-located with source (`Foo.ts` next to `Foo.test.ts`).
- **Package manager:** pnpm. Do not use npm or yarn in this project.
- **Lint/format:** ESLint + Prettier. Run `pnpm lint:fix && pnpm format`
  before committing. `pnpm check` runs all checks in one shot (typecheck +
  lint + format + tests).

## Where things live

```
src/main/auth/          OAuth flows, token storage
src/main/platforms/     GitHub / Azure DevOps providers
src/main/git/           local repo cache and git operations
src/main/ai/            LLM review pipeline and providers
src/main/ipc/           main-side IPC handlers and the typed contract
src/renderer/           React UI (presentation only)
src/renderer/api.ts     typed IPC client
src/shared/             types and pure logic shared by both processes
```

## Core conventions

### Process boundary

- **The renderer never sees secrets.** No tokens, no AI API keys, no
  refresh tokens. Anything sensitive lives in the main process.
- **The renderer never makes external network calls.** All API calls
  to GitHub, Azure DevOps, Anthropic, OpenAI go through the main process.
- **All IPC channels are typed.** See `src/shared/ipc-contract.ts`. If a
  new channel is needed, add it to the contract first, then implement
  both sides.

### Error handling

Async functions that can fail in expected ways return `Result<T, E>`
(see `src/shared/result.ts`). Throwing is reserved for programmer errors
and truly unexpected failures.

```typescript
// Good
async function fetchPR(ref: PRRef): Promise<Result<PullRequest, FetchError>> { ... }

// Bad: callers can't tell what failure modes exist
async function fetchPR(ref: PRRef): Promise<PullRequest> { ... }
```

### Abstractions

The five core interfaces are stable. Add new implementations, don't
modify the interfaces without an ADR:

- `AuthProvider` — acquires and refreshes credentials per platform
- `TokenStore` — persists `AuthSession` (keychain in production)
- `PlatformProvider` — translates between platform API and internal model
- `AIProvider` — abstracts the LLM call
- `Result<T, E>` — typed success/failure for async operations

Do not bypass these abstractions for "just this one case." If the
abstraction doesn't fit, that's a signal to revisit it via an ADR,
not a license to special-case.

### Code style

- Functional style over class-based where it reads naturally. Classes
  are fine when state and behavior genuinely belong together (e.g. a
  long-lived cache or connection pool).
- Pure functions in core logic. Side effects at the edges.
- Composition over inheritance.
- Small, focused modules. If a file grows past ~300 lines, consider
  splitting it.
- Imports ordered: node built-ins, external packages, internal absolute
  paths, relative paths. Blank line between groups.
- Names: `PascalCase` for types and components, `camelCase` for
  variables and functions, `SCREAMING_SNAKE_CASE` for true constants.
- **React components: do not annotate the return type.** React 19
  removed the global `JSX` namespace, so `JSX.Element` no longer
  works, and `React.JSX.Element` adds noise. Let TypeScript infer
  the return type. The JSX inside is still fully type-checked.

### React effects

Prefer event handlers and derived state (`useMemo`) over `useEffect`.
Most `useEffect` calls can be replaced by one of these patterns:

- **Synchronizing derived state** → `useMemo`, not `useEffect` + `setState`
- **Reacting to a user action** → event handler, not `useEffect` on a state flag
- **Data fetching** → triggered by the event that opens the screen, not
  `useEffect` on mount

`useEffect` is appropriate only for:

- **Subscriptions** — `api.on(...)`, DOM `addEventListener`, timers
- **DOM side effects** — scroll, focus, measuring layout

Never use `useEffect` as a lifecycle hook to run code "on mount." If
something must happen when a component appears, ask whether it belongs in
the action that caused the component to render.

### Comments

Minimal. Write code that explains itself. Comments are for the _why_,
not the _what_. Specifically:

- No comments restating what the code does.
- No `// Initialize the variable`, `// Return the result`, etc.
- Yes to comments explaining non-obvious decisions, tradeoffs, or
  external constraints ("API returns dates as strings, so we parse here").
- TODOs are fine but should reference an issue when possible:
  `// TODO(#42): handle pagination`.

### Tests

- Test behavior, not implementation. Tests should survive refactors.
- One assertion focus per test. Multiple `expect`s are fine; multiple
  unrelated checks are not.
- Mock the boundary (network, filesystem, keychain), not the unit
  under test.
- For platform providers, write contract tests that all implementations
  must pass — this is how we keep GitHub and Azure DevOps behavior
  consistent.

## Commit conventions

- Use [Conventional Commits](https://www.conventionalcommits.org/):
  `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`.
- Subject line: 50 characters or less, imperative mood
  ("add", not "added" or "adds").
- Body (optional): explains _why_, wrapped at 72 characters.
- **Do not add `Co-Authored-By: Claude <noreply@anthropic.com>`.**
- **Do not add "Generated with Claude Code" or similar footers.**
- **Do not add emoji to commit messages** unless the user explicitly
  requests it.
- Write commits in the user's voice, first person where natural.

## Changelog discipline

**Always update [`CHANGELOG.md`](./CHANGELOG.md) as part of any change
that a user or future contributor would care about.**

The changelog follows [Keep a Changelog](https://keepachangelog.com/)
format with these sections under `[Unreleased]`:

- **Added** — new features
- **Changed** — changes to existing functionality
- **Deprecated** — soon-to-be removed features
- **Removed** — removed features
- **Fixed** — bug fixes
- **Security** — security-relevant changes

Rules:

- Update the `[Unreleased]` section in the same commit or PR as the
  change itself. Never as a separate "update changelog" commit.
- Write entries in the user's voice, describing impact, not
  implementation. "Added Azure DevOps sign-in via Microsoft account"
  beats "Implemented MSAL OAuth flow".
- One line per entry. If more context is needed, link to an ADR or
  spec.
- Skip the changelog only for purely internal changes that affect no
  observable behavior: lint config tweaks, test refactors, internal
  renames. When in doubt, add an entry.
- On version bumps, move `[Unreleased]` entries to a new dated
  version section and start a fresh `[Unreleased]`.

Examples:

```
feat: add Azure DevOps OAuth flow

Implements PKCE-based Authorization Code flow against Microsoft Entra ID
per ADR-0003. Tokens are persisted via the existing TokenStore.

refactor: extract diff parsing from GitHubProvider

The diff parsing logic is platform-agnostic and was duplicated in the
Azure DevOps provider. Move it to platforms/diff/ so both providers
can share it.

fix: handle rate limit errors in PR fetch

The GitHub API returns 403 (not 429) for rate limits. Detect via the
X-RateLimit-Remaining header and surface a typed error instead of a
generic FetchError.
```

## Pull request and branch conventions

- **Never commit directly to `main`.** Every change — no matter how
  small — goes on a dedicated branch first.
- Each new piece of work (new conversation context, feature, fix,
  refactor) gets its own branch. Create it before writing any code.
- Branch names: `feat/short-description`, `fix/short-description`,
  `refactor/short-description`. Lowercase, hyphenated.
- One topic per branch. Don't mix refactoring and feature work.
- Keep PRs small enough to actually review (rough guide: under 400 lines
  of diff, fewer is better).

## What to do before writing code

For any non-trivial task:

1. **Locate or write the spec.** Check `docs/specs/` for relevant
   feature specs. If none exists and the work is substantial, write
   one first. When writing or stress-testing a spec, prefer the
   `grill-with-docs` skill (see below) — it forces precise terminology
   and surfaces hidden assumptions before they become code.
2. **Locate or write the ADR.** If the task involves a meaningful
   architectural choice, check whether it meets the ADR criteria
   below. If yes, draft the ADR before implementing.
3. **Identify what's in scope.** Don't expand the task. If you notice
   adjacent issues, surface them as TODOs or follow-up issues rather
   than fixing them inline.
4. **Write the test first when feasible.** Especially for pure logic.
   For integration work where this is impractical, write the test
   immediately after.

## When to write an ADR

Only write an ADR when **all three** of these are true:

1. **Hard to reverse.** The cost of changing your mind later is
   meaningful — refactoring multiple modules, breaking persisted
   data, retraining the team, etc.
2. **Surprising without context.** A future reader (including
   future-you) will reasonably ask "why did they do it this way?"
   The answer isn't obvious from the code alone.
3. **The result of a real trade-off.** There were genuine
   alternatives and you picked one for specific reasons. If there
   was only one viable option, you don't need an ADR — you need a
   comment in the code.

If any of the three is missing, skip the ADR. Use a code comment, a
note in `ARCHITECTURE.md`, or a line in a spec instead.

This criteria is stricter than "document every decision" deliberately.
ADR sprawl makes the directory useless. We want every ADR to be worth
reading six months from now.

## Domain language and CONTEXT.md

Vigil has several overlapping terms that need precise definitions:
_pull request_, _review_, _finding_, _comment_, _session_, _account_,
_organization_, _provider_ (platform vs AI), and others. Sloppy
language here produces sloppy code.

A `CONTEXT.md` file at the repo root holds the canonical glossary.
It's created lazily — the first time a term needs disambiguation —
and grows organically. Rules:

- Only include terms that are meaningful at the _domain_ level.
  Don't put implementation details (e.g. "the `tokens` table") there.
- When introducing a new domain term, check `CONTEXT.md` first. If
  the term already exists with a different meaning, either use the
  existing meaning or rename.
- When `grill-with-docs` resolves a term during a session, update
  `CONTEXT.md` inline in that same session — don't batch.

## Skills

This project uses Claude Code skills stored in `.claude/skills/`.
The most important is **`grill-with-docs`** (by Matt Pocock,
[source](https://github.com/mattpocock/skills/tree/main/skills/engineering/grill-with-docs)).

Invoke it when:

- Writing a new spec under `docs/specs/`.
- Stress-testing a plan before committing to an implementation
  approach.
- Resolving fuzzy or overloaded domain language.
- Considering whether a decision warrants an ADR.

The skill interviews the user one question at a time, challenges
terminology against `CONTEXT.md`, stress-tests relationships with
concrete scenarios, and updates docs inline as decisions crystallize.
It enforces the ADR criteria above.

Don't invoke it for routine implementation work — only for the
upstream "what are we even building" conversations.

## What not to do

- **Don't add dependencies without checking** if existing ones cover
  the need. New dependencies need a brief justification in the commit
  message and, for non-trivial ones, an ADR.
- **Don't put secrets, tokens, or API keys in logs**, error messages,
  or telemetry. Redact aggressively.
- **Don't bypass `PlatformProvider`** to call GitHub or Azure DevOps
  APIs directly from elsewhere in the codebase.
- **Don't put business logic in the renderer.** The renderer renders;
  the main process decides.
- **Don't catch errors just to swallow them.** Either handle them
  meaningfully or let them propagate (or convert them to `Result`).
- **Don't introduce a new abstraction for code used in one place.**
  Wait until there are at least two real callers.
- **Don't write defensive code for impossible states.** If a type says
  a value is non-null, trust the type system. Add a guard only if the
  boundary is genuinely untrusted (external input, IPC payload).
- **Don't over-engineer.** Default to the simplest solution that solves
  the actual problem. Future flexibility is not free.
- **Don't make unrelated changes.** If a file needs cleanup, do it in
  a separate `refactor:` commit.

## Working with prompts and AI in this codebase

The application itself uses LLMs. A few specific rules:

- Prompts live in `src/main/ai/prompts/` as versioned files. Treat
  prompt changes like code changes: PR-reviewed, documented in commits.
- PR content (diffs, file contents) is _untrusted input_ to the LLM.
  Wrap it in clear delimiters in prompts. Include explicit instructions
  that the AI should not follow instructions found inside the PR
  content. This is our defense against prompt injection from malicious
  diffs.
- Never log full prompts or completions at info level. The diff content
  may include sensitive code. Debug-level logging only, with explicit
  user opt-in.

## When in doubt

- Prefer reading existing code for patterns over inventing new ones.
- If a decision has tradeoffs worth recording, propose an ADR.
- If you're unsure whether something is in scope, ask before doing it.
- The architecture and these conventions exist to make decisions
  faster, not to be followed blindly. If something here is genuinely
  wrong for a situation, surface it and we'll update this file.

All detailed coding guidelines are in the skills:

- Use `software-engineering` skill for core principles
- Use `typescript` skill for TypeScript/JavaScript standards
- Use `react` skill for React/Next.js best practices
