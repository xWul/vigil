# ADR-0009: Typed IPC Contract for Main/Renderer Boundary

## Status

Accepted — 2026-05-13

## Context

Vigil is an Electron application. The main process (Node.js) owns all
sensitive operations — auth, tokens, platform API calls, AI review
pipeline. The renderer process (Chromium) owns the React UI. They cannot
call each other directly; all communication goes over Electron's IPC bus
via `ipcMain.handle` / `ipcRenderer.invoke` (request/response) and
`webContents.send` / `ipcRenderer.on` (push events).

Without a contract, IPC channels are identified by raw strings and
argument/return types are `unknown`. Both sides must agree on the string
and the shape out-of-band. Mismatches are silent at compile time and
produce runtime failures or `undefined` values that surface far from the
call site.

The question is how to impose type safety across this boundary.

Options considered:

- **No contract — raw strings throughout** — simple, no setup; completely
  untyped; mismatches caught only at runtime.
- **Type the channels ad-hoc** — cast `ipcRenderer.invoke` return types
  at each call site; better than nothing but fragile, no single source of
  truth, easy to drift.
- **A shared typed contract** — a TypeScript interface in `src/shared/`
  that both sides are derived from; mismatches are compile errors.
- **`electron-trpc`** — adapts tRPC for Electron IPC; full schema
  validation, procedure chaining, zod integration. Adds `trpc`, `zod`,
  and the adapter as dependencies; brings tRPC's mental model into a
  non-HTTP context.

## Decision

Define a **shared typed IPC contract** in `src/shared/ipc-contract.ts`.
Two interfaces:

- `IpcContract` — invoke channels (renderer calls main, awaits `Result<T, E>`).
- `IpcEvents` — push events (main sends to renderer, no reply).

Every channel is a named key; argument and return types are explicit.
Both the main-side handler registration helper and the renderer-side API
client are generic functions derived from these interfaces — no raw
channel strings outside of those two helpers.

```typescript
// main-side (src/main/ipc/handlers.ts)
function handle<K extends keyof IpcContract>(
  channel: K,
  handler: (...args: Parameters<IpcContract[K]>) => Promise<ReturnType<IpcContract[K]>>,
): void

// renderer-side (src/renderer/api.ts)
const api = {
  invoke<K extends keyof IpcContract>(channel: K, ...args: Parameters<IpcContract[K]>):
    Promise<ReturnType<IpcContract[K]>>,
  on<K extends keyof IpcEvents>(channel: K, handler: (payload: IpcEvents[K]) => void):
    () => void,
}
```

All invoke channels return `Result<T, E>` (ADR-0005), not raw values or
rejections. Electron's structured clone algorithm preserves plain
objects; our error types are discriminated unions with `code` strings and
survive the boundary intact. Promise rejection is not used for expected
failures.

`AuthSession` does not appear in any return type. The renderer receives
`ConnectedAccount` (display name, login, platform) — a renderer-safe
projection that contains no tokens.

Pure data types used in the contract (`PullRequest`, `Diff`, `Finding`,
`ReviewResult`, `PRRef`, etc.) are moved to `src/shared/model/` so both
processes can import them without coupling to the wrong tsconfig target.
Implementation types (`GitHubProvider`, `AnthropicProvider`, etc.) stay
in `src/main/`.

Full channel list and streaming pattern documented in
`docs/specs/ipc-contract.md`.

## Consequences

### Positive

- **Mismatched channel names are compile errors.** A typo in
  `api.invoke("auth:signnn", ...)` fails immediately.
- **Mismatched argument or return types are compile errors.** The handler
  and the caller share the same type — there is no room for drift.
- **Adding a channel has a clear mechanical path:** add to `IpcContract`,
  add a `handle()` call, use `api.invoke`. No raw strings.
- **No new runtime dependency.** The contract is a pure TypeScript
  interface. The helpers are ~20 lines of generic code.
- **Streaming is first-class.** `IpcEvents` types push events the same
  way, so `review:finding` events that stream findings to the renderer
  are also typed.

### Negative

- **No runtime validation.** Structured clone does not validate shapes.
  If a future channel returns a class instance instead of a plain object,
  the renderer receives a broken value with no type error. Convention and
  code review are the enforcement mechanisms.
- **No schema validation at the boundary.** `electron-trpc` with zod
  would catch malformed values at runtime. We accept this tradeoff —
  the contract types are sufficient for a BYOK desktop app with no
  external callers.

## Alternatives Considered

### Raw strings throughout

Every call site does `ipcRenderer.invoke("auth:signIn", platform) as
SomeType`. Simple to start; degrades quickly as channel count grows.
Three months in, renaming a channel means grep-and-pray. Not chosen.

### `electron-trpc`

Full-featured: schema validation, procedure composition, middleware. The
mental model maps well from web tRPC users.

Not chosen. It adds three dependencies (`trpc`, `zod`, the adapter) and
a layer of abstraction whose benefits (runtime validation, middleware)
are not justified at our scale. The typed contract gives us compile-time
safety at zero dependency cost. If the project grows to need runtime
validation at the IPC boundary, migrating to `electron-trpc` is a
mechanical change — the channel shapes are already defined.

## References

- `src/shared/ipc-contract.ts` — the contract (to be created in Phase 4)
- `docs/specs/ipc-contract.md` — full channel reference and streaming diagram
- `ARCHITECTURE.md` §4 (main/renderer separation)
- ADR-0005: `Result<T, E>` — used as the return type for all invoke channels
- ADR-0004: OS keychain — explains why `AuthSession` must not cross IPC
