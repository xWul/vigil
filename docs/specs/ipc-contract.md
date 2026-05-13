# Spec: IPC Contract

## Goal

Define the typed boundary between the Electron main process (Node.js)
and the renderer process (React UI). Every capability the renderer needs
from the main process is expressed as a named channel with explicit
argument and return types. Neither side uses raw IPC strings — both sides
are derived from the shared contract type.

---

## Background

Electron runs two OS processes that cannot call each other directly:

- **Main process** — Node.js. Owns auth, tokens, platform providers, AI
  pipeline, OS keychain. No DOM.
- **Renderer process** — Chromium. Owns the React UI. No Node APIs, no
  direct network access, no secrets.

They communicate via Electron's IPC bus (`ipcMain.handle` /
`ipcRenderer.invoke` for request/response; `webContents.send` /
`ipcRenderer.on` for push events). Without a typed contract, this bus
becomes a stringly-typed surface prone to silent mismatches.

---

## Type sharing

Pure data types with no Node.js dependencies are moved to `src/shared/`
so both processes can import them without coupling to the wrong
environment:

- `src/shared/model/` — `PullRequest`, `Diff`, `FileDiff`, `Hunk`,
  `DiffLine`, `PRRef`, `Finding`, `ReviewResult`, `AuthError`,
  `NewComment`, `NewReview`, `Comment`
- `src/shared/auth.ts` — `ConnectedAccount` (renderer-safe identity)
- `src/shared/settings.ts` — `Settings`, `WritableSettings`, `SettingsError`
- `src/shared/ipc-contract.ts` — `IpcContract`, `IpcEvents`

Implementation types (`GitHubProvider`, `AnthropicProvider`,
`AuthProvider`, `CodeAnalyzer`, etc.) remain in `src/main/`.

---

## Contract shape

```typescript
// src/shared/ipc-contract.ts

import type { Result } from "./result.js";
import type { AuthError, ConnectedAccount } from "./auth.js";
import type { Settings, SettingsError, WritableSettings } from "./settings.js";
import type { Comment, Diff, FindingPass, NewComment, NewReview, PRRef, PullRequest } from "./model/index.js";
import type { Finding, ReviewError, ReviewResult } from "./review.js";

// ── Invoke channels (renderer → main, returns Promise<Result<T, E>>) ────────

export interface IpcContract {
  // Auth
  "auth:signIn": (platform: "github" | "azure-devops") => Result<ConnectedAccount, AuthError>;
  "auth:signInWithPAT": (platform: "github" | "azure-devops", token: string) => Result<ConnectedAccount, AuthError>;
  "auth:signOut": (platform: "github" | "azure-devops") => Result<void, AuthError>;
  "auth:getAccounts": () => Result<readonly ConnectedAccount[], never>;

  // Platform
  "platform:listPRs": () => Result<readonly PullRequest[], PlatformError>;
  "platform:getPRWithDiff": (ref: PRRef) => Result<{ pr: PullRequest; diff: Diff }, PlatformError>;
  "platform:submitReview": (ref: PRRef, review: NewReview) => Result<void, PlatformError>;
  "platform:postComment": (ref: PRRef, comment: NewComment) => Result<Comment, PlatformError>;

  // Review
  "review:run": (ref: PRRef) => Result<ReviewResult, ReviewError>;
  "review:getCached": (ref: PRRef, headSha: string) => Result<ReviewResult | null, never>;

  // Settings
  "settings:get": () => Result<Settings, never>;
  "settings:set": (update: Partial<WritableSettings>) => Result<void, SettingsError>;
  "settings:setApiKey": (provider: "anthropic" | "openai", key: string) => Result<void, SettingsError>;
  "settings:deleteApiKey": (provider: "anthropic" | "openai") => Result<void, SettingsError>;
}

// ── Push events (main → renderer, one-way) ───────────────────────────────────

export interface IpcEvents {
  "review:finding": { reviewId: string; finding: Finding };
  "review:pass": { reviewId: string; pass: FindingPass; status: "start" | "complete"; count: number };
}
```

---

## Channel reference

### `auth:signIn(platform)`

Opens the platform's OAuth browser flow (GitHub Device Flow or Azure
DevOps PKCE Authorization Code). Returns the signed-in `ConnectedAccount`
on success. Blocks until the user completes or cancels the browser flow.
The `AuthSession` is persisted to the OS keychain internally; only
`ConnectedAccount` crosses IPC.

### `auth:signInWithPAT(platform, token)`

Validates and stores a Personal Access Token. The renderer collects the
token from the user (text input) and passes it here. Returns `ConnectedAccount`
on success, `{ code: "auth_failed" }` if the token is empty or rejected.

### `auth:signOut(platform)`

Signs out the given platform. Deletes the `AuthSession` from the keychain.
Always local-only — server-side revocation is best-effort.

### `auth:getAccounts()`

Returns all currently signed-in accounts. The renderer uses this to
populate the auth screen and any platform selector. Returns an empty array
if no accounts are connected — never an error.

### `platform:listPRs()`

Returns open pull requests assigned to the signed-in user across all
connected platforms. Calls each connected `PlatformProvider` in parallel
and merges results. Returns `PlatformError` only if all providers fail;
partial failures from individual providers are silently omitted and logged.

### `platform:getPRWithDiff(ref)`

Returns the PR metadata and structured diff together. Used by the Review
Workspace screen which needs both to render. Combining them avoids two
sequential round-trips that would stall the page load.

### `platform:submitReview(ref, review)` / `platform:postComment(ref, comment)`

Direct wrappers over `PlatformProvider.submitReview` and `postComment`.
The renderer constructs the `NewReview` / `NewComment` shape; the main
process calls the appropriate provider.

### `review:run(ref)`

Runs the full review pipeline for the given PR. Invoke semantics:

- The returned Promise resolves with `Result<ReviewResult, ReviewError>`
  when the review is complete (all static + AI passes done).
- While running, the main process emits `review:finding` and `review:pass`
  push events so the renderer can display findings incrementally.

The `reviewId` in push events is the PR's `headSha`. The renderer uses
this to correlate push events to the active review when the user
navigates between PRs.

If AI is not configured (no API key), static analysis findings are still
returned; `ReviewResult.summary` is empty and `riskScore` is null.

Results are cached by `headSha` (see review cache). If the same commit
has already been reviewed, `review:run` returns the cached result
immediately without running the pipeline.

### `review:getCached(ref, headSha)`

Checks the review cache without running the pipeline. Used by the Review
Workspace to show a "cached result available" indicator before the user
triggers a full run.

### `settings:get()`

Returns the current `Settings`. Includes `hasAnthropicKey` and
`hasOpenAIKey` booleans — never the keys themselves. Always succeeds
(error type is `never`).

### `settings:set(update)`

Updates non-sensitive settings (provider choice, model, log level).
`WritableSettings` excludes the boolean key-presence flags.

### `settings:setApiKey(provider, key)` / `settings:deleteApiKey(provider)`

Stores or removes an AI API key in the OS keychain via `SecretStore`.
The key is never read back over IPC; subsequent calls to `settings:get`
reflect the change via the boolean flags.

---

## Error handling

All invoke channels return `Result<T, E>`. Errors never reject the
Promise — Electron's structured clone algorithm preserves plain objects
(our error types are discriminated unions with `code` strings) but loses
class instances.

The renderer pattern for every invoke call:

```typescript
const result = await api.invoke("auth:signIn", "github");
if (!result.ok) {
  // result.error is fully typed
  switch (result.error.code) {
    case "cancelled":
      /* dismiss */ break;
    case "network":
      /* retry button */ break;
    case "timeout":
      /* expired message */ break;
  }
  return;
}
// result.value is ConnectedAccount
```

---

## Streaming review findings

```
renderer                             main
   |                                   |
   |-- review:run(ref) -------------> |  invoke
   |                                   |  [static passes, parallel]
   |<-- review:pass(start, static) -- |  push
   |<-- review:finding(f1) --------- |  push
   |<-- review:finding(f2) --------- |  push
   |<-- review:pass(done, static) -- |  push
   |                                   |  [AI correctness pass]
   |<-- review:pass(start, ...) ----- |  push
   |<-- review:finding(f3) --------- |  push
   |<-- review:pass(done, ...) ------ |  push
   |                                   |  [security, consistency, summary...]
   |<-- ...                            |
   |<-- review:run resolves --------- |  invoke response (ReviewResult)
```

The renderer accumulates `review:finding` events into a local list and
renders them as they arrive. The invoke resolution delivers the final
`ReviewResult` (including `summary` and `riskScore`) and signals that
the review is complete.

---

## Typed helpers

The shared contract type drives two generated helpers:

**Main-side handler registration** (`src/main/ipc/handlers.ts`):

```typescript
function handle<K extends keyof IpcContract>(channel: K, handler: (...args: Parameters<IpcContract[K]>) => Promise<ReturnType<IpcContract[K]>>): void {
  ipcMain.handle(channel, (_event, ...args) => handler(...(args as Parameters<IpcContract[K]>)));
}
```

**Renderer-side API client** (`src/renderer/api.ts`):

```typescript
const api = {
  invoke<K extends keyof IpcContract>(channel: K, ...args: Parameters<IpcContract[K]>): Promise<ReturnType<IpcContract[K]>> {
    return ipcRenderer.invoke(channel, ...args);
  },
  on<K extends keyof IpcEvents>(channel: K, handler: (payload: IpcEvents[K]) => void): () => void {
    const listener = (_event: IpcRendererEvent, payload: IpcEvents[K]) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.off(channel, listener);
  },
};
```

Both helpers are compile errors if the channel name or argument types
don't match the contract. A missing handler on the main side is caught
at startup, not at runtime.

---

## SecretStore

API keys are stored in the OS keychain via `SecretStore`:

```typescript
interface SecretStore {
  set(key: string, value: string): Promise<void>;
  get(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
}
```

Keys used: `"anthropic-api-key"`, `"openai-api-key"`. The main process
reads from `SecretStore` when constructing `AIProvider` instances — the
renderer never sees the keys.

Implementations: `KeychainSecretStore` (production) and
`FileSecretStore` (dev/CI).

---

## Settings persistence

Non-sensitive settings are stored as JSON at
`app.getPath('userData')/settings.json`. The `Settings` type maps
directly to the stored shape, with `hasAnthropicKey` / `hasOpenAIKey`
computed at read-time by checking `SecretStore`.

---

## Exit criteria

- `pnpm typecheck` passes with the contract type defined and both the
  main handler registration and renderer API client derived from it.
- Adding a new channel requires only: (1) add to `IpcContract`, (2) add
  a `handle()` call in `src/main/ipc/handlers.ts`, (3) use via `api.invoke`
  in the renderer. No raw strings anywhere.
- Mismatched argument types between handler and caller are compile errors.
- `AuthSession` does not appear in any channel's return type.
