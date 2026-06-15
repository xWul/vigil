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

const URL_CREDENTIAL = /(https?:\/\/)[^@/\s]+@/gi;
const BEARER_TOKEN = /(bearer\s+)[A-Za-z0-9._~+/-]+=*/gi;

export function scrubString(s: string): string {
  return s.replace(URL_CREDENTIAL, "$1[redacted]@").replace(BEARER_TOKEN, "$1[redacted]");
}

const SENSITIVE_KEY = /token|secret|key|password|pat/i;
const MAX_DEPTH = 8;

function walkValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (depth > MAX_DEPTH) return "[truncated]";
  if (typeof value === "string") return scrubString(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((item) => walkValue(item, seen, depth + 1));
    seen.delete(value);
    return result;
  }
  const obj = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : walkValue(v, seen, depth + 1);
  }
  seen.delete(value);
  return result;
}

export function redact(meta: Record<string, unknown>): Record<string, unknown> {
  return walkValue(meta, new WeakSet(), 0) as Record<string, unknown>;
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
