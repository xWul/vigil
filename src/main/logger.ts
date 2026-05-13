import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";

import { type Logger, type LogLevel, redact } from "../shared/logger.js";

const LEVEL_RANK: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };
const MAX_BYTES = 5 * 1024 * 1024;

function parseLevel(raw: string): LogLevel {
  return raw in LEVEL_RANK ? (raw as LogLevel) : "error";
}

export class FileLogger implements Logger {
  private readonly rank: number;
  private readonly archive: string;

  constructor(
    private readonly filePath: string,
    level: LogLevel = "error",
  ) {
    this.rank = LEVEL_RANK[level];
    this.archive = filePath + ".old";
    mkdirSync(dirname(filePath), { recursive: true });
  }

  static fromEnv(filePath: string): FileLogger {
    return new FileLogger(filePath, parseLevel(process.env["VIGIL_LOG_LEVEL"] ?? ""));
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
    this.rotateIfNeeded();
    const safeMeta = meta ? redact(meta) : undefined;
    const suffix = safeMeta ? ` ${JSON.stringify(safeMeta)}` : "";
    const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${msg}${suffix}\n`;
    appendFileSync(this.filePath, line, "utf-8");
  }

  private rotateIfNeeded(): void {
    if (!existsSync(this.filePath)) return;
    if (statSync(this.filePath).size < MAX_BYTES) return;
    renameSync(this.filePath, this.archive);
  }
}
