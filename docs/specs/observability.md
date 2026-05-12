# Spec: Observability Foundation

**Phase:** 1.5 (interface) + 4 (Electron transport)
**Status:** Ready for implementation
**Related:** ADR-0006 (electron-log), `ARCHITECTURE.md` §12

---

## Goal

Every operation in Vigil's main process that can fail or is
performance-sensitive emits a structured log entry. The logging
abstraction is established in Phase 1.5 so Phases 2 and 3 can
instrument their code immediately; the production file transport
(rotating log file, Electron path resolution, redaction) is wired up
in Phase 4 once the Electron runtime exists.

Tokens and secrets never appear in any log. Users can increase
verbosity for debugging without recompiling. The "Copy diagnostics"
button (Phase 7) reads and redacts this file to produce a bug report.

---

## Inputs

- Operations in progress: auth flows, API calls, IPC handlers, AI
  pipeline calls.
- `VIGIL_LOG_LEVEL` environment variable (optional): sets the active
  log level for the session.
- Log metadata objects passed by callers: arbitrary key/value pairs
  describing the event.

---

## Outputs

**Phases 1.5–3 (console only):**
- Structured output to `process.stderr` when `VIGIL_LOG_LEVEL` is set.
- Silent by default (`NoopLogger` in tests; `ConsoleLogger` only when
  injected explicitly in scripts).

**Phase 4+ (Electron file transport):**
- A log file at the platform's default log path:
  - macOS: `~/Library/Logs/vigil/main.log`
  - Windows: `%AppData%\vigil\logs\main.log`
  - Linux: `~/.config/vigil/logs/main.log`
- One archive kept when the file exceeds 5 MB (`main.old.log`).
- Console transport mirrors file output in `electron-vite dev`.

## Electron transport configuration

Configured in `src/main/logger.ts`, injected at app startup:

- **Library:** `electron-log/main`
- **File path:** `app.getPath('logs') + "/vigil.log"`
- **Max size:** 5 MB; one archive (`vigil.old.log`) kept on rotation
- **Default level:** `error` (file and console)
- **Override:** `VIGIL_LOG_LEVEL` environment variable
- **Redaction:** applied before any transport (see Redaction section below)

---

## Delivery split

### Phase 1.5 — interface only (no Electron dependency)

`src/shared/logger.ts` provides three exports:

```typescript
export interface Logger {
  error(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  debug(msg: string, meta?: Record<string, unknown>): void;
}

export class NoopLogger implements Logger { /* all methods no-op */ }

export class ConsoleLogger implements Logger {
  constructor(private readonly level: "error"|"warn"|"info"|"debug" = "error") {}
  // wraps console.error / console.warn / console.info / console.debug
  // respects level hierarchy; honours VIGIL_LOG_LEVEL env var at construction
}
```

All auth providers and main-process modules accept `Logger` as an
optional constructor parameter defaulting to `NoopLogger`. They never
import any concrete logger implementation — only the `Logger` interface.

During Phases 2 and 3, inject `ConsoleLogger` manually in scripts and
ad-hoc development runs. Tests always use `NoopLogger`.

### Phase 4 — Electron transport

`src/main/logger.ts` provides the production singleton backed by
`electron-log`. It implements the same `Logger` interface and is
injected at app startup, replacing the `ConsoleLogger` used during
development. See "Electron transport configuration" below.

---

## Log levels

| Level   | When to use                                          | Default on? |
| ------- | ---------------------------------------------------- | ----------- |
| `error` | Unrecoverable failures; unexpected errors            | Yes         |
| `warn`  | Recoverable problems; things that are worth watching | Yes (file)  |
| `info`  | Key lifecycle events (sign-in, API call, refresh)    | No          |
| `debug` | Low-level detail useful only when diagnosing a bug   | No          |

The default level is `error`. Set `VIGIL_LOG_LEVEL=info` or
`VIGIL_LOG_LEVEL=debug` to see more.

---

## Redaction

A `redact(meta: Record<string, unknown>): Record<string, unknown>`
helper replaces the **value** of any key matching
`/token|secret|key|password|pat/i` with the string `"[redacted]"`.
This runs before the message reaches any transport, even at `debug`.

```typescript
redact({ accessToken: "ghp_abc", login: "wesleymoura" })
// → { accessToken: "[redacted]", login: "wesleymoura" }
```

The redaction rule applies to top-level keys only in v1. Nested objects
are passed through as-is (callers are responsible for not nesting
secrets inside non-sensitive keys).

---

## Log events by module

### Auth flows (Phase 1)

| Event                            | Level   | Meta fields                    |
| -------------------------------- | ------- | ------------------------------ |
| `github.signIn.start`            | `info`  | —                              |
| `github.signIn.deviceCodeIssued` | `info`  | `expiresIn` (seconds)          |
| `github.signIn.polling`          | `debug` | `attempt`                      |
| `github.signIn.complete`         | `info`  | `login`                        |
| `github.signIn.failed`           | `error` | `code`                         |
| `github.refresh.noop`            | `debug` | —                              |
| `github.signOut`                 | `info`  | —                              |
| `ado.signIn.start`               | `info`  | —                              |
| `ado.signIn.listenerReady`       | `debug` | `port`                         |
| `ado.signIn.browserOpened`       | `info`  | —                              |
| `ado.signIn.callbackReceived`    | `debug` | —                              |
| `ado.signIn.complete`            | `info`  | `upn`, `displayName`           |
| `ado.signIn.failed`              | `error` | `code`                         |
| `ado.refresh.start`              | `debug` | —                              |
| `ado.refresh.complete`           | `info`  | `expiresAt` (ISO timestamp)    |
| `ado.refresh.failed`             | `warn`  | `code`                         |
| `ado.signOut`                    | `info`  | —                              |
| `pat.signIn.complete`            | `info`  | `platform`                     |
| `pat.signIn.failed`              | `warn`  | `code`                         |
| `pat.signOut`                    | `info`  | `platform`                     |
| `auth.refreshRetry.attempt`      | `debug` | `provider`                     |
| `auth.refreshRetry.success`      | `info`  | `provider`                     |
| `auth.refreshRetry.failed`       | `warn`  | `provider`, `code`             |
| `auth.refreshRetry.secondUnauth` | `warn`  | `provider`                     |

### Platform API calls (Phase 2)

| Event               | Level  | Meta fields                          |
| ------------------- | ------ | ------------------------------------ |
| `api.request`       | `info` | `method`, `url` (no auth params), `provider` |
| `api.response`      | `info` | `status`, `latencyMs`, `provider`    |
| `api.rateLimit`     | `warn` | `remaining`, `resetAt`, `provider`   |
| `api.error`         | `error`| `status`, `code`, `provider`         |

### AI pipeline (Phase 3)

| Event                  | Level   | Meta fields                              |
| ---------------------- | ------- | ---------------------------------------- |
| `ai.call.start`        | `info`  | `model`, `estimatedInputTokens`          |
| `ai.call.complete`     | `info`  | `model`, `latencyMs`, `outputTokens`     |
| `ai.call.streamError`  | `warn`  | `model`, `error`                         |
| `ai.call.failed`       | `error` | `model`, `code`                          |
| `ai.prompt.full`       | `debug` | `prompt` — only when user opts in        |

### IPC handlers (Phase 4)

| Event            | Level   | Meta fields              |
| ---------------- | ------- | ------------------------ |
| `ipc.call`       | `debug` | `channel`                |
| `ipc.error`      | `error` | `channel`, `message`     |

---

## What is never logged

- Access tokens, refresh tokens, PATs — redacted automatically.
- Full prompt content or LLM completions — `debug` only, and only when
  the user has explicitly enabled verbose logging. They may contain
  sensitive diff content.
- HTTP `Authorization` header values.
- Keychain raw bytes.

---

## Acceptance criteria

### Phase 1.5

- [ ] `VIGIL_LOG_LEVEL=info pnpm auth:ado` prints `ado.signIn.start`
  and `ado.signIn.complete` to the console.
- [ ] `VIGIL_LOG_LEVEL=debug` produces `ado.signIn.listenerReady` and
  `auth.refreshRetry.attempt` entries.
- [ ] Without `VIGIL_LOG_LEVEL` set, no output is produced (NoopLogger
  default).
- [ ] All existing tests pass; no `electron-log` import anywhere in the
  test environment.

### Phase 4

- [ ] Running the Electron app and signing in writes entries to
  `~/Library/Logs/vigil/main.log` (macOS).
- [ ] The log file contains no string matching a real access token.
- [ ] Log file rotation works: file is archived at 5 MB.
- [ ] Settings screen shows the active log level and an "Open log file"
  button.

---

## Out of scope for Phase 1.5

- Settings UI for the log level toggle (Phase 4).
- "Copy diagnostics" button (Phase 7).
- Renderer-process logging (not needed until Phase 4 UI exists).
- Remote error reporting of any kind.
