# ADR-0006: Local Structured Logging with electron-log

## Status

Accepted — 2026-05-12

## Context

Vigil's main process makes many calls that can fail silently or in
subtle ways: OAuth token exchanges, external API requests to GitHub and
Azure DevOps, streaming LLM responses, IPC round-trips. Without
instrumentation, diagnosing production issues requires users to either
reproduce the problem or describe it from memory.

At the same time, Vigil's core privacy promise is that no user data
leaves the machine without explicit action. A conventional SaaS
approach — shipping telemetry to a hosted error-tracking service — is
incompatible with that promise.

Three requirements shape the choice:

1. **Logs must stay local.** No data sent to any server we or a third
   party operates.
2. **Tokens and secrets must never appear in logs.** Even at the most
   verbose level.
3. **The library must work in Electron's main process** without
   additional plumbing for log file paths or rotation.

Options evaluated:

- **`electron-log`** — purpose-built for Electron; handles
  `app.getPath('logs')` automatically, includes file rotation, supports
  both main and renderer processes.
- **Pino** — fastest structured logger for Node.js; outputs JSON; but
  requires `pino-roll` for rotation and manual resolution of Electron's
  log path. More setup for the same result.
- **Winston** — flexible transports; heavier API; not Electron-aware;
  same manual path/rotation concern as Pino.
- **Custom / `console.*` redirect** — zero dependencies; fine for small
  scripts but no rotation, no structured output, no level control.

## Decision

Use **`electron-log`** (`electron-log/main`) as the logging library,
delivered in two phases to respect the Electron runtime boundary.

**Phase 1.5 — interface only** (`src/shared/logger.ts`):
A `Logger` interface with `error / warn / info / debug` methods, a
`NoopLogger` for tests, and a `ConsoleLogger` for development use in
Phases 2–3. No Electron dependency. All providers accept `Logger` by
injection, defaulting to `NoopLogger`.

**Phase 4 — Electron transport** (`src/main/logger.ts`):
The production singleton backed by `electron-log`, injected at app
startup. This is where file rotation, `app.getPath('logs')` path
resolution, and the redaction helper live.

Configuration (Phase 4):

- **File transport**: `app.getPath('logs')/vigil.log`, max 5 MB, one
  archive kept (`vigil.old.log`).
- **Default level**: `error` — only errors written to disk in normal
  use.
- **Override**: `VIGIL_LOG_LEVEL` environment variable sets both the
  file and console transports.
- **Redaction**: a `redact(meta)` helper strips any metadata field
  whose key matches `/token|secret|key|password|pat/i` before the
  message reaches any transport. This runs unconditionally, even at
  `debug` level.

## Consequences

### Positive

- **No telemetry plumbing.** `electron-log` resolves the platform log
  path automatically (`~/Library/Logs/vigil/` on macOS,
  `%AppData%\vigil\logs\` on Windows). No manual path construction.
- **Rotation out of the box.** The 5 MB cap and single archive prevent
  unbounded disk growth without a separate dependency.
- **Renderer compatible.** If the renderer ever needs to emit log
  events, `electron-log`'s IPC transport routes them to the main
  process log file transparently.
- **Testable.** `NoopLogger` lets every unit test remain fast and
  silent without mocking a concrete library.
- **Privacy by default.** Redaction is applied before any transport
  sees the message, making token leakage into log files a
  compiler-preventable mistake rather than a discipline requirement.

### Negative

- **CJS module.** `electron-log` 5.x ships CommonJS. In the ESM
  TypeScript project, the import works via Node's CJS interop, but
  `import log from "electron-log/main"` requires a default import
  rather than a named one.
- **Electron-only transport.** The `electron-log/main` entry requires
  `app.getPath` to be available. It is only imported in
  `src/main/logger.ts`, which is only loaded by the Electron app
  (Phase 4+). Phases 1.5–3 use `ConsoleLogger` or `NoopLogger` via
  injection; they never import `src/main/logger.ts` directly.
- **One active log file.** The single-file rotation model is sufficient
  for a desktop app but would not scale to a high-volume service.
  Acceptable trade-off for v1.

## Alternatives Considered

### Pino

Pino is the fastest structured logger for Node.js and outputs JSON
natively. Its ecosystem (`pino-roll`, `pino-pretty`) is mature.

Not chosen. It provides no Electron-specific affordances. Adding
`pino-roll` for rotation and manually resolving `app.getPath('logs')`
reproduces what `electron-log` provides out of the box, at the cost
of two extra dependencies and more setup code.

### Winston

Winston's transport model is familiar and flexible. It has an
active community and good TypeScript types.

Not chosen for the same reasons as Pino: no Electron-aware file path
resolution, requires a separate rotation transport, and its API
surface is significantly larger than what Vigil needs.

### No library (`console.*` redirected to a file)

Zero new dependencies. A simple `fs.createWriteStream` appended on
each `console.*` call.

Not chosen. This approach requires hand-rolling level filtering,
rotation, structured serialization, and renderer-process integration.
The maintenance burden exceeds the value of avoiding a dependency,
especially for a cross-cutting concern.

## References

- `docs/specs/observability.md` — feature specification
- `ARCHITECTURE.md` §12 — observability design intent
- `src/shared/logger.ts` — Logger interface and NoopLogger
- `src/main/logger.ts` — electron-log implementation
- ROADMAP.md Phase 1.5 — implementation checklist
