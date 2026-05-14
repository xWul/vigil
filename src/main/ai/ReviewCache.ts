import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ReviewResult } from "./CodeAnalyzer";

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface CacheEntry {
  storedAt: number;
  result: ReviewResult;
}

export class ReviewCache {
  private readonly dir: string;

  constructor(cacheDir: string) {
    this.dir = cacheDir;
    mkdirSync(cacheDir, { recursive: true });
  }

  get(headSha: string): ReviewResult | null {
    const path = this.entryPath(headSha);
    if (!existsSync(path)) return null;
    try {
      const entry = JSON.parse(readFileSync(path, "utf-8")) as CacheEntry;
      if (Date.now() - entry.storedAt > TTL_MS) return null;
      return entry.result;
    } catch {
      return null;
    }
  }

  set(headSha: string, result: ReviewResult): void {
    const entry: CacheEntry = { storedAt: Date.now(), result };
    try {
      writeFileSync(this.entryPath(headSha), JSON.stringify(entry), "utf-8");
    } catch {
      // Cache write failures are non-fatal
    }
  }

  private entryPath(headSha: string): string {
    return join(this.dir, `${headSha}.json`);
  }
}
