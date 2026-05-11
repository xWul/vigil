# Architecture — Vigil

> **Status:** Living document. Last updated 2026-05-11.
> **Audience:** Engineers (including future-me and AI coding assistants) working on Vigil.
> **Companion docs:** [`CLAUDE.md`](./CLAUDE.md) for AI coding assistant instructions, [`docs/adr/`](./docs/adr/) for individual decisions, [`docs/specs/`](./docs/specs/) for per-feature specifications.

---

## 1. What this is

Vigil is a desktop application for AI-assisted code review. The user opens it, signs into one or more git hosting platforms (GitHub, Azure DevOps), and reviews pull requests with the help of a large language model that they bring their own API key for.

The name reflects the product's purpose: a vigil is something you *keep* — deliberately, patiently, with full attention. Code review at its best is exactly that.

The product thesis: AI-assisted authoring (Claude Code, Cursor, Copilot) has made it dramatically easier to *produce* code than to *review* it. Existing review tools (the GitHub PR page, the Azure DevOps web UI) were built for a world of carefully-authored, carefully-reviewed changes. Vigil is built for a world where the bottleneck is review, not authorship.

This document describes how Vigil is structured to deliver on that thesis.

---

## 2. Goals and non-goals

### Goals

- **Review is the primary activity.** The UI is organised around pending reviews, not around files and folders.
- **AI-augmented, not AI-automated.** The LLM surfaces issues and provides context; the human approves, requests changes, or pushes back.
- **Bring Your Own Key (BYOK).** Users supply their own Anthropic or OpenAI API key. The application never proxies AI traffic through a server we operate.
- **Multi-platform from day one.** GitHub and Azure DevOps supported through a common abstraction. GitLab and others can be added without redesign.
- **Local-first.** Repositories are cloned locally for deep analysis. Tokens are stored in the OS keychain. The application works without any backend we operate.
- **Modern auth.** OAuth 2.0 Authorization Code flow with PKCE, with personal access tokens as a fallback.

### Non-goals (for the initial version)

- We do not host anything server-side. No accounts on our infrastructure, no analytics ingestion.
- We do not replace the platform's PR page entirely. Merging, branch protection, CI status, and admin operations happen on the platform.
- We do not edit code in this application. It is a review tool, not a full IDE. Users can open files in their preferred editor.
- We do not support arbitrary LLM providers initially. Anthropic Claude and OpenAI are the two supported providers in v1.

---

## 3. Stack

| Layer | Choice | Reason |
|---|---|---|
| Application shell | Electron | Mature, cross-platform, large ecosystem. We accept the bundle-size tradeoff. (See ADR-0001.) |
| Language | TypeScript 5.7+ (strict mode, no `any`) | Strong types across the full stack, hireable skill, excellent tooling. |
| Main process runtime | Node.js 24 LTS ("Krypton") | Active LTS through April 2028. Production-ready while staying current. Node.js 26 is Current but not yet LTS, and native modules in the Electron ecosystem typically lag a new major. |
| Renderer UI | React 19.2.6+ | Current major. Pin to 19.2.1 or later to avoid the React2Shell vulnerability that affected 19.0.0 through 19.2.0 (we don't use Server Components in a desktop app, but the patched version is still the right floor). |
| Build tool | Vite 6 + electron-vite | Fast dev loop, modern bundling. |
| Test runner | Vitest 3 | Fast, ESM-native, good TypeScript support. |
| Auth library (Microsoft) | MSAL Node (`@azure/msal-node`) | Official Microsoft library; handles PKCE, token cache, refresh. |
| Auth library (GitHub) | Octokit OAuth helpers | Official GitHub libraries. |
| Token storage | OS keychain via `keytar` (or `@napi-rs/keyring`) | Native secure storage; never roll our own. |
| Git operations | `simple-git` (shells out to git) | Reliable; we don't need libgit2-level control. |
| AI SDKs | `@anthropic-ai/sdk`, `openai` | Official SDKs from each provider. |

Anything else (utility libraries, UI components) is decided per-need and recorded in an ADR if non-trivial.

---

## 4. High-level architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                              Vigil                               │
│                       (Electron application)                     │
│                                                                  │
│  ┌────────────────────────┐         ┌────────────────────────┐  │
│  │   Renderer Process      │  IPC   │     Main Process        │  │
│  │   (React UI)            │ <────> │     (Node.js)           │  │
│  │                         │ typed  │                         │  │
│  │  - Review Queue         │ bridge │  - Auth flows           │  │
│  │  - Diff View            │        │  - Token storage        │  │
│  │  - AI Conversation      │        │  - Platform providers   │  │
│  │  - Settings             │        │  - Git operations       │  │
│  │  - No business logic    │        │  - AI review pipeline   │  │
│  │  - No secrets           │        │  - All side effects     │  │
│  └────────────────────────┘         └──────────┬─────────────┘  │
│                                                 │                │
└─────────────────────────────────────────────────┼────────────────┘
                                                  │
                  ┌───────────────────────────────┼───────────────┐
                  │                               │               │
                  ▼                               ▼               ▼
        ┌──────────────────┐         ┌──────────────────┐  ┌─────────────┐
        │  Git Platforms   │         │   AI Providers   │  │ OS Keychain │
        │                  │         │                  │  │             │
        │ - GitHub API     │         │ - Anthropic API  │  │ - macOS KC  │
        │ - Azure DevOps   │         │ - OpenAI API     │  │ - Win Cred  │
        │   API + Entra ID │         │                  │  │ - libsecret │
        └──────────────────┘         └──────────────────┘  └─────────────┘
```

**Key separation:** the renderer process is presentation-only. It never sees an OAuth token, never makes a network call to an external API, never touches the keychain. All sensitive operations happen in the main process. The renderer asks for things via typed IPC; the main process does the work and returns results.

This is the correct security architecture for an Electron app and matches Electron's official guidance.

---

## 5. Module layout

```
src/
├── main/                          # Electron main process (Node.js)
│   ├── index.ts                   # entry point
│   ├── ipc/
│   │   ├── handlers.ts            # registers IPC handlers
│   │   └── contract.ts            # typed channels (shared with renderer)
│   ├── auth/
│   │   ├── AuthProvider.ts        # interface
│   │   ├── AzureDevOpsAuthProvider.ts   # Entra ID OAuth + PKCE
│   │   ├── GitHubAuthProvider.ts        # OAuth Device Flow + PKCE
│   │   ├── PATAuthProvider.ts           # manual token fallback
│   │   ├── pkce.ts                # verifier/challenge helpers
│   │   └── tokenStore.ts          # keychain wrapper
│   ├── platforms/
│   │   ├── PlatformProvider.ts    # interface
│   │   ├── AzureDevOpsProvider.ts
│   │   ├── GitHubProvider.ts
│   │   └── model/                 # internal normalized types
│   │       ├── PullRequest.ts
│   │       ├── Diff.ts
│   │       └── Comment.ts
│   ├── git/
│   │   └── repoCache.ts           # local clone management
│   ├── ai/
│   │   ├── AIProvider.ts          # interface
│   │   ├── AnthropicProvider.ts
│   │   ├── OpenAIProvider.ts
│   │   ├── reviewEngine.ts        # multi-pass pipeline
│   │   └── prompts/               # prompts as versioned files
│   └── config/
│       └── settings.ts            # user prefs, AI keys (in keychain)
│
├── renderer/                      # React UI
│   ├── index.tsx                  # entry point
│   ├── App.tsx
│   ├── api.ts                     # typed IPC client (mirrors contract)
│   ├── routes/
│   │   ├── ReviewQueue.tsx
│   │   ├── ReviewWorkspace.tsx
│   │   ├── AuthScreen.tsx
│   │   └── Settings.tsx
│   ├── components/
│   │   ├── DiffView/
│   │   ├── FindingCard/
│   │   └── ...
│   └── state/                     # client-side state (Zustand or similar)
│
├── shared/                        # types and pure logic shared by both
│   ├── ipc-contract.ts
│   ├── result.ts                  # Result<T, E> type
│   └── models/                    # types both processes use
│
└── test/                          # integration tests, fixtures
```

Tests live next to the source they test (`Foo.ts` and `Foo.test.ts` in the same directory). Integration tests that span modules live in `src/test/`.

---

## 6. Key abstractions

### 6.1 `AuthProvider`

```typescript
interface AuthProvider {
  readonly id: 'github' | 'azure-devops' | 'pat';
  signIn(): Promise<Result<AuthSession, AuthError>>;
  refresh(session: AuthSession): Promise<Result<AuthSession, AuthError>>;
  signOut(session: AuthSession): Promise<Result<void, AuthError>>;
}
```

Each provider knows how to acquire and refresh credentials for one platform. The result is an `AuthSession` containing tokens, expiry, and user/org info — never exposed to the renderer.

### 6.2 `TokenStore`

```typescript
interface TokenStore {
  save(key: string, session: AuthSession): Promise<void>;
  load(key: string): Promise<AuthSession | null>;
  delete(key: string): Promise<void>;
}
```

The production implementation is keychain-backed. A file-based implementation exists for development on machines without a keychain.

### 6.3 `PlatformProvider`

```typescript
interface PlatformProvider {
  readonly id: 'github' | 'azure-devops';
  listOpenPullRequests(scope: PRScope): Promise<PullRequest[]>;
  getPullRequest(ref: PRRef): Promise<PullRequest>;
  getDiff(ref: PRRef): Promise<Diff>;
  postComment(ref: PRRef, comment: NewComment): Promise<Comment>;
  submitReview(ref: PRRef, review: NewReview): Promise<void>;
}
```

Each provider translates between the platform's API and our internal normalized model. The rest of the application never sees a GitHub-specific or Azure-specific shape.

### 6.4 `AIProvider`

```typescript
interface AIProvider {
  readonly id: 'anthropic' | 'openai';
  complete(req: CompletionRequest): Promise<CompletionResult>;
  stream(req: CompletionRequest): AsyncIterable<CompletionChunk>;
}
```

Abstracts the LLM call. Lets the review engine work against either provider, and makes it possible to swap models per pass.

### 6.5 `Result<T, E>`

Async functions return `Result<T, E>` instead of throwing across module boundaries. Exceptions are still used for programmer errors and truly unexpected failures, but expected failure modes (network error, auth expired, rate limited) are typed.

```typescript
type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };
```

---

## 7. The AI review pipeline

The review engine is the heart of the product. It runs multiple specialised passes over a diff, then merges the findings.

```
                ┌────────────────────┐
                │   PullRequest +    │
                │  surrounding code  │
                └─────────┬──────────┘
                          │
              ┌───────────┴───────────┐
              │   Context Builder      │  Selects which files,
              │                        │  history, and related code
              │                        │  to include, fitting the
              │                        │  AI's context window.
              └───────────┬───────────┘
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
        ▼                 ▼                 ▼
  ┌──────────┐      ┌──────────┐      ┌──────────┐
  │Correctness│      │ Security │      │Consistency│
  │   pass    │      │   pass   │      │   pass    │
  └────┬─────┘      └────┬─────┘      └────┬─────┘
       │                  │                  │
       └──────────┬───────┴────────┬─────────┘
                  │                 │
                  ▼                 ▼
            ┌──────────┐      ┌──────────┐
            │  Merge & │      │ Summary  │
            │  dedupe  │      │   pass   │
            └────┬─────┘      └────┬─────┘
                 │                 │
                 └────────┬────────┘
                          │
                          ▼
                  ┌──────────────┐
                  │ ReviewResult │
                  └──────────────┘
```

Why multiple passes instead of one big prompt: focused prompts produce better results than catch-all ones, and we can use different models or temperatures per pass (e.g., a cheaper model for the summary, a stronger one for security). Each pass is independently testable.

Detailed pipeline behaviour lives in [`docs/specs/ai-review-pipeline.md`](./docs/specs/ai-review-pipeline.md).

---

## 8. Authentication flow

Detailed in [ADR-0003](./docs/adr/0003-pkce-for-desktop-oauth.md). Summary:

1. User clicks "Sign in with Microsoft" in the renderer.
2. Renderer sends `auth:signIn` IPC with `{ provider: 'azure-devops' }`.
3. Main process generates PKCE verifier and challenge, starts a local HTTP listener on a free port, opens the user's default browser to Microsoft's authorize URL.
4. User authenticates in their browser. Microsoft redirects back to `http://localhost:{port}/callback?code=...`.
5. Main process captures the code, shuts down the local listener, exchanges the code (with the PKCE verifier) for tokens via MSAL.
6. Tokens are persisted to the OS keychain via `TokenStore`.
7. Renderer receives a `Result<UserInfo, AuthError>` — never the tokens themselves.

Token refresh happens transparently inside `PlatformProvider` calls. A 401 from the API triggers a refresh, and the original call is retried once.

---

## 9. Data flow: reviewing a PR

A typical user journey, end to end:

1. User opens the app. Renderer asks main: "give me my review queue." Main process calls each connected `PlatformProvider`, normalizes the results, returns a unified list.
2. User clicks a PR. Renderer asks for the PR details. Main process fetches the PR metadata via API and clones (or `git fetch`es) the repo into the local cache if not already present.
3. Renderer asks: "run AI review on this PR." Main process invokes the review engine, which:
   - builds context from the diff and surrounding code,
   - runs each pass against the configured `AIProvider`, streaming progress back to the renderer via IPC,
   - merges and returns the `ReviewResult`.
4. Renderer displays findings inline with the diff. User can click any finding to chat with the AI about it — this is another IPC round-trip that uses `AIProvider.stream()` so the response streams into the UI.
5. When the user approves or requests changes, the renderer asks the main process to call `PlatformProvider.submitReview()`.

No part of this flow exposes tokens or AI keys to the renderer.

---

## 10. Security model

The threats we consider, and how we address them:

| Threat | Mitigation |
|---|---|
| Token theft from disk | OS keychain only; never written to plain files or logs. |
| Token leakage to renderer | Strict main/renderer separation; renderer cannot read tokens via any IPC channel. |
| Token leakage to AI provider | Diffs and code are sent to the AI; tokens are not part of any prompt. We document this clearly. |
| Code leakage to third parties | Only the configured AI provider receives code. No telemetry, no analytics. |
| Malicious AI output as code execution | AI responses are rendered as text, never `eval`d. Suggested fixes are displayed as diffs, never auto-applied. |
| Compromised dependencies | Dependencies are pinned. We document why each one is included. Renovate or similar handles updates with review. |
| Prompt injection from PR content | Prompts treat PR content as untrusted data, wrapped in clear delimiters, with explicit instructions not to follow instructions found in the diff. |

Cryptographic and storage details for tokens are in [ADR-0004](./docs/adr/0004-keychain-for-token-storage.md).

---

## 11. Build, run, distribute

### Local development

```bash
pnpm install
pnpm dev          # Vite + Electron in dev mode with hot reload
pnpm test         # Vitest
pnpm test:e2e     # Playwright against built app
pnpm lint
pnpm typecheck
```

### Packaging

`electron-builder` produces installers for macOS (.dmg), Windows (.exe), and Linux (.AppImage, .deb). Code signing is configured per platform; see [`docs/build-and-release.md`](./docs/build-and-release.md) (TBD).

### Auto-update

Out of scope for v1. For an open-source portfolio project, GitHub Releases is sufficient; users download new versions manually. If the project grows, electron-updater is the standard choice.

---

## 12. Observability

For a local-first BYOK desktop app, classic SaaS observability doesn't apply. We instead provide:

- **Structured logs** to a local rotating file (`~/.your-app/logs/`). Off by default beyond errors; user can enable verbose logging in Settings.
- **No telemetry** to any server we operate. Period.
- **Error reporting** is manual: users can click "Copy diagnostics" in the app to get a redacted bundle they paste into a GitHub issue.

If we ever add opt-in telemetry, it will be an ADR with explicit user consent in-app.

---

## 13. What we deliberately defer

These are interesting and may make sense later, but are not v1:

- GitLab and Bitbucket providers (the abstraction supports them; we just don't ship them yet).
- Semantic diff (understanding what *changed in meaning*, not just text).
- Repository-wide indexing with embeddings for "find similar code" features.
- Inline AI suggestions that the user can apply as commits.
- Team features (shared review templates, organisation-level rules).
- Mobile companion app for read-only review on the go.
- Web-hosted version.

Each of these is a candidate for a future RFC.

---

## 14. Open questions

Tracked here until resolved by an ADR or spec:

- **Local repo cache eviction policy.** How much disk do we use, and how do we age out unused clones?
- **Prompt versioning.** Prompts live in files under `src/main/ai/prompts/`. We need a story for evolving them without breaking review reproducibility.
- **Configurable review depth.** "Skim mode" vs "deep mode" — does the user choose, does the AI choose based on risk, or both?
- **Offline behaviour.** When the user is offline, the platform APIs are unreachable but the local cache still has diffs. What works, what gracefully degrades?

---

## 15. How to evolve this document

`ARCHITECTURE.md` describes the system as it actually is, not as it was originally imagined. When a significant change lands:

1. Write or update an ADR in `docs/adr/` capturing the *why*.
2. Update this document so the *what* and *how* stay accurate.
3. Keep the diff small and intentional — this file is meant to be read end-to-end.

If you find yourself writing more than a page of detail about one component, that detail probably belongs in a spec under `docs/specs/`, with a one-paragraph summary here that links to it.
