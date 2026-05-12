export type LogLevel = "error" | "warn" | "info" | "debug";

const LEVEL_RANK: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

function isLogLevel(s: string): s is LogLevel {
  return s in LEVEL_RANK;
}

export function redact(meta: Record<string, unknown>): Record<string, unknown> {
  const SENSITIVE = /token|secret|key|password|pat/i;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    result[k] = SENSITIVE.test(k) ? "[redacted]" : v;
  }
  return result;
}

export interface Logger {
  error(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  debug(msg: string, meta?: Record<string, unknown>): void;
}

/* eslint-disable @typescript-eslint/no-empty-function */
export class NoopLogger implements Logger {
  error(_msg: string, _meta?: Record<string, unknown>): void {}
  warn(_msg: string, _meta?: Record<string, unknown>): void {}
  info(_msg: string, _meta?: Record<string, unknown>): void {}
  debug(_msg: string, _meta?: Record<string, unknown>): void {}
}
/* eslint-enable @typescript-eslint/no-empty-function */

export class ConsoleLogger implements Logger {
  private readonly rank: number;

  constructor(level: LogLevel = "error") {
    this.rank = LEVEL_RANK[level];
  }

  static fromEnv(): ConsoleLogger {
    const raw = process.env["VIGIL_LOG_LEVEL"] ?? "";
    return new ConsoleLogger(isLogLevel(raw) ? raw : "error");
  }

  error(msg: string, meta?: Record<string, unknown>): void {
    if (this.rank >= LEVEL_RANK.error) this.write("error", msg, meta);
  }

  warn(msg: string, meta?: Record<string, unknown>): void {
    if (this.rank >= LEVEL_RANK.warn) this.write("warn", msg, meta);
  }

  info(msg: string, meta?: Record<string, unknown>): void {
    if (this.rank >= LEVEL_RANK.info) this.write("info", msg, meta);
  }

  debug(msg: string, meta?: Record<string, unknown>): void {
    if (this.rank >= LEVEL_RANK.debug) this.write("debug", msg, meta);
  }

  private write(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
    const ts = new Date().toISOString();
    const safeMeta = meta ? redact(meta) : undefined;
    const line = safeMeta
      ? `${ts} [${level.toUpperCase()}] ${msg} ${JSON.stringify(safeMeta)}`
      : `${ts} [${level.toUpperCase()}] ${msg}`;
    process.stderr.write(line + "\n");
  }
}
