import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { repoKey, remoteUrl, RepoCache } from "./RepoCache.js";
import type { PRRef } from "../platforms/model/index.js";
import type { AuthSession } from "../auth/AuthProvider.js";

// ── fixtures ─────────────────────────────────────────────────────────────────

const githubRef: PRRef = { platform: "github", owner: "acme", repo: "api", number: 1 };
const adoRef: PRRef = {
  platform: "azure-devops",
  org: "myorg",
  project: "myproj",
  repo: "myrepo",
  id: 42,
};

const githubSession: AuthSession = {
  provider: "github",
  accessToken: "ghp_token",
  displayName: "Alice",
  login: "alice",
};

const patSession: AuthSession = {
  provider: "pat",
  platform: "azure-devops",
  accessToken: "pat123",
};

// ── repoKey ───────────────────────────────────────────────────────────────────

describe("repoKey", () => {
  it("produces a github key", () => {
    expect(repoKey(githubRef)).toBe("github/acme/api");
  });

  it("produces an azure-devops key", () => {
    expect(repoKey(adoRef)).toBe("azure-devops/myorg/myproj/myrepo");
  });
});

// ── remoteUrl ─────────────────────────────────────────────────────────────────

describe("remoteUrl", () => {
  it("builds a github url with x-access-token credential", () => {
    expect(remoteUrl(githubSession, githubRef)).toBe(
      "https://x-access-token:ghp_token@github.com/acme/api.git",
    );
  });

  it("builds an azure devops url with pat credential", () => {
    expect(remoteUrl(patSession, adoRef)).toBe(
      "https://:pat123@dev.azure.com/myorg/myproj/_git/myrepo",
    );
  });
});

// ── RepoCache.readFile ────────────────────────────────────────────────────────

describe("RepoCache.readFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "vigil-repocache-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("returns not_ready when the .git directory is absent", async () => {
    const cache = new RepoCache(tmpDir);
    // @ts-expect-error — accessing private field for test
    cache.gitCheckPromise = Promise.resolve(true);

    const result = await cache.readFile(githubRef, "abc123", "src/index.ts");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_ready");
    }
  });

  it("returns not_ready when git is unavailable", async () => {
    const cache = new RepoCache(tmpDir);
    // @ts-expect-error — accessing private field for test
    cache.gitCheckPromise = Promise.resolve(false);

    const result = await cache.readFile(githubRef, "abc123", "src/index.ts");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_ready");
    }
  });
});

// ── RepoCache.evict ───────────────────────────────────────────────────────────

describe("RepoCache.evict", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "vigil-evict-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function makeRepo(name: string, lastFetchAt: number): string {
    const repoDir = join(tmpDir, name);
    mkdirSync(join(repoDir, ".git"), { recursive: true });
    writeFileSync(join(repoDir, ".vigil-meta.json"), JSON.stringify({ lastFetchAt }));
    writeFileSync(join(repoDir, ".git", "dummy"), "x".repeat(100));
    return repoDir;
  }

  it("removes repos whose lastFetchAt is older than 30 days", async () => {
    const staleTime = Date.now() - 31 * 24 * 60 * 60 * 1000;
    const freshTime = Date.now() - 1000;

    const staleDir = makeRepo("stale-repo", staleTime);
    const freshDir = makeRepo("fresh-repo", freshTime);

    const cache = new RepoCache(tmpDir);
    // @ts-expect-error — accessing private field for test
    cache.gitCheckPromise = Promise.resolve(true);

    await cache.evict();

    expect(existsSync(staleDir)).toBe(false);
    expect(existsSync(freshDir)).toBe(true);
  });

  it("evicts repos with no metadata file (lastFetchAt treated as 0)", async () => {
    const repoDir = join(tmpDir, "no-meta");
    mkdirSync(join(repoDir, ".git"), { recursive: true });

    const cache = new RepoCache(tmpDir);
    // @ts-expect-error — accessing private field for test
    cache.gitCheckPromise = Promise.resolve(true);

    await cache.evict();

    expect(existsSync(repoDir)).toBe(false);
  });

  it("skips all operations when git is unavailable", async () => {
    const freshTime = Date.now() - 1000;
    const repoDir = makeRepo("fresh-repo", freshTime);

    const cache = new RepoCache(tmpDir);
    // @ts-expect-error — accessing private field for test
    cache.gitCheckPromise = Promise.resolve(false);

    await cache.evict();

    expect(existsSync(repoDir)).toBe(true);
  });
});
