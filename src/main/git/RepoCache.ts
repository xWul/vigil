import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import simpleGit from "simple-git";

import { err, ok } from "../../shared/result.js";
import type { Result } from "../../shared/result.js";
import { scrubString, NoopLogger } from "../../shared/logger.js";
import type { Logger } from "../../shared/logger.js";
import type { AuthSession } from "../auth/AuthProvider.js";
import type { PRRef } from "../platforms/model/index.js";

const execFileAsync = promisify(execFile);

const STALE_MS = 15 * 60 * 1000;
const EVICT_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 2 * 1024 * 1024 * 1024;
const META_FILE = ".vigil-meta.json";

interface RepoCacheMeta {
  lastFetchAt: number;
}

export type RepoCacheStatus = "cloning" | "fetching" | "ready" | "error";

export interface GitCacheStatusEvent {
  readonly repoKey: string;
  readonly status: RepoCacheStatus;
  readonly error?: string;
}

export type RepoCacheError =
  | { readonly code: "not_ready" }
  | { readonly code: "not_found"; readonly path: string }
  | { readonly code: "git_error"; readonly message: string };

function repoPathSegments(ref: PRRef): string[] {
  return ref.platform === "github"
    ? ["github", ref.owner, ref.repo]
    : ["azure-devops", ref.org, ref.project, ref.repo];
}

export function repoKey(ref: PRRef): string {
  return repoPathSegments(ref).join("/");
}

export function remoteUrl(ref: PRRef): string {
  if (ref.platform === "github") {
    return `https://github.com/${ref.owner}/${ref.repo}.git`;
  }
  return `https://dev.azure.com/${ref.org}/${ref.project}/_git/${ref.repo}`;
}

export function authHeader(session: AuthSession): string {
  if (session.provider === "azure-devops") {
    return `Bearer ${session.accessToken}`;
  }
  if (session.provider === "pat" && session.platform === "azure-devops") {
    return `basic ${Buffer.from(`:${session.accessToken}`).toString("base64")}`;
  }
  return `basic ${Buffer.from(`x-access-token:${session.accessToken}`).toString("base64")}`;
}

function gitAuthEnv(session: AuthSession): Record<string, string> {
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: ${authHeader(session)}`,
  };
}

function readMeta(metaPath: string): RepoCacheMeta | null {
  try {
    return JSON.parse(readFileSync(metaPath, "utf-8")) as RepoCacheMeta;
  } catch {
    return null;
  }
}

function writeMeta(metaPath: string, meta: RepoCacheMeta): void {
  writeFileSync(metaPath, JSON.stringify(meta));
}

function dirSize(dir: string): number {
  let total = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = join(dir, entry.name);
      total += entry.isDirectory() ? dirSize(child) : statSync(child).size;
    }
  } catch {
    // ignore permission errors on git internals
  }
  return total;
}

async function checkGitAvailable(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("git", ["--version"]);
    const match = /(\d+)\.(\d+)/.exec(stdout);
    if (!match) return false;
    const major = parseInt(match[1]!, 10);
    const minor = parseInt(match[2]!, 10);
    return major > 2 || (major === 2 && minor >= 31);
  } catch {
    return false;
  }
}

export class RepoCache {
  private readonly cacheDir: string;
  private readonly logger: Logger;
  private statusListener?: (event: GitCacheStatusEvent) => void;
  private readonly inFlight = new Map<string, Promise<void>>();
  private gitCheckPromise: Promise<boolean> | null = null;

  constructor(cacheDir: string, logger: Logger = new NoopLogger()) {
    this.cacheDir = cacheDir;
    this.logger = logger;
    mkdirSync(cacheDir, { recursive: true });
  }

  setStatusListener(fn: (event: GitCacheStatusEvent) => void): void {
    this.statusListener = fn;
  }

  private emit(event: GitCacheStatusEvent): void {
    this.statusListener?.(event);
  }

  private async isGitAvailable(): Promise<boolean> {
    if (this.gitCheckPromise === null) {
      this.gitCheckPromise = checkGitAvailable().then((available) => {
        if (!available) {
          this.logger.warn("git.unavailable", {
            message: "git >= 2.31 not found; local repo cache disabled",
          });
        }
        return available;
      });
    }
    return this.gitCheckPromise;
  }

  private repoDirFor(ref: PRRef): string {
    return join(this.cacheDir, ...repoPathSegments(ref));
  }

  /** Triggers a background clone or fetch; callers do not await this. */
  ensureCloned(session: AuthSession, ref: PRRef): void {
    void this._triggerCloneOrFetch(session, ref);
  }

  private async _triggerCloneOrFetch(session: AuthSession, ref: PRRef): Promise<void> {
    if (!(await this.isGitAvailable())) return;

    const key = repoKey(ref);
    if (this.inFlight.has(key)) return;

    const repoDir = this.repoDirFor(ref);
    const metaPath = join(repoDir, META_FILE);
    const isCloned = existsSync(join(repoDir, ".git"));

    if (isCloned) {
      const meta = readMeta(metaPath);
      if (meta && Date.now() - meta.lastFetchAt < STALE_MS) return;
    }

    const op = (
      isCloned
        ? this._fetch(session, ref, repoDir, metaPath)
        : this._clone(session, ref, repoDir, metaPath)
    )
      .catch((e) => {
        const message = scrubString(e instanceof Error ? e.message : String(e));
        this.logger.warn("git.cache.error", { key, message });
        this.emit({ repoKey: key, status: "error", error: message });
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, op);
  }

  private async _clone(
    session: AuthSession,
    ref: PRRef,
    repoDir: string,
    metaPath: string,
  ): Promise<void> {
    const key = repoKey(ref);
    this.emit({ repoKey: key, status: "cloning" });
    this.logger.info("git.cache.clone.start", { key });

    mkdirSync(dirname(repoDir), { recursive: true });
    const git = simpleGit().env({ ...process.env, ...gitAuthEnv(session) });
    await git.clone(remoteUrl(ref), repoDir, ["--filter=blob:none", "--no-checkout"]);

    writeMeta(metaPath, { lastFetchAt: Date.now() });
    this.logger.info("git.cache.clone.done", { key });
    this.emit({ repoKey: key, status: "ready" });
  }

  private async _fetch(
    session: AuthSession,
    ref: PRRef,
    repoDir: string,
    metaPath: string,
  ): Promise<void> {
    const key = repoKey(ref);
    this.emit({ repoKey: key, status: "fetching" });
    this.logger.info("git.cache.fetch.start", { key });

    const git = simpleGit(repoDir).env({ ...process.env, ...gitAuthEnv(session) });
    await git.remote(["set-url", "origin", remoteUrl(ref)]);
    await git.fetch(["--filter=blob:none"]);

    writeMeta(metaPath, { lastFetchAt: Date.now() });
    this.logger.info("git.cache.fetch.done", { key });
    this.emit({ repoKey: key, status: "ready" });
  }

  /** Read a file at a specific commit from the local clone. */
  async readFile(
    ref: PRRef,
    sha: string,
    filePath: string,
  ): Promise<Result<string, RepoCacheError>> {
    if (!(await this.isGitAvailable())) return err({ code: "not_ready" });

    const repoDir = this.repoDirFor(ref);
    if (!existsSync(join(repoDir, ".git"))) return err({ code: "not_ready" });

    const key = repoKey(ref);
    if (this.inFlight.has(key)) return err({ code: "not_ready" });

    try {
      const content = await simpleGit(repoDir).show([`${sha}:${filePath}`]);
      return ok(content);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes("does not exist") ||
        msg.includes("not a tree") ||
        msg.includes("bad object")
      ) {
        return err({ code: "not_found", path: filePath });
      }
      return err({ code: "git_error", message: msg });
    }
  }

  /** Delete stale entries and enforce the 2 GB size cap. Run on app startup. */
  async evict(): Promise<void> {
    if (!(await this.isGitAvailable())) return;

    const now = Date.now();
    const entries = this._listCacheEntries();

    for (const entry of entries) {
      if (now - entry.lastFetchAt > EVICT_AGE_MS) {
        this.logger.info("git.cache.evict.age", { dir: entry.dir });
        rmSync(entry.dir, { recursive: true, force: true });
      }
    }

    const remaining = this._listCacheEntries();
    let totalBytes = remaining.reduce((sum, e) => sum + e.size, 0);

    if (totalBytes > MAX_BYTES) {
      const sorted = [...remaining].sort((a, b) => a.lastFetchAt - b.lastFetchAt);
      for (const entry of sorted) {
        if (totalBytes <= MAX_BYTES) break;
        this.logger.info("git.cache.evict.size", { dir: entry.dir, bytes: entry.size });
        rmSync(entry.dir, { recursive: true, force: true });
        totalBytes -= entry.size;
      }
    }
  }

  private _listCacheEntries(): { dir: string; size: number; lastFetchAt: number }[] {
    const results: { dir: string; size: number; lastFetchAt: number }[] = [];
    this._walkForRepoDirs(this.cacheDir, results, 0);
    return results;
  }

  private _walkForRepoDirs(
    dir: string,
    out: { dir: string; size: number; lastFetchAt: number }[],
    depth: number,
  ): void {
    if (depth > 4) return;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const child = join(dir, entry.name);
        if (existsSync(join(child, ".git"))) {
          const meta = readMeta(join(child, META_FILE));
          out.push({ dir: child, size: dirSize(child), lastFetchAt: meta?.lastFetchAt ?? 0 });
        } else {
          this._walkForRepoDirs(child, out, depth + 1);
        }
      }
    } catch {
      // ignore unreadable dirs
    }
  }
}
