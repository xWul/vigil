import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { repoKey, remoteUrl, authHeader, RepoCache } from "./RepoCache.js";
import type { PRRef } from "../platforms/model/index.js";
import type { AuthSession } from "../auth/AuthProvider.js";

// Capture the URL passed to git.clone so the disk-safety test can assert it.
const { cloneSpy } = vi.hoisted(() => ({
  cloneSpy: vi.fn<(url: string, dest: string, opts: string[]) => Promise<void>>(),
}));

vi.mock("simple-git", () => ({
  default: vi.fn(() => ({
    clone: cloneSpy,
    env: vi.fn(function (this: Record<string, unknown>) {
      return this;
    }),
    remote: vi.fn().mockResolvedValue(""),
    fetch: vi.fn().mockResolvedValue({}),
    show: vi.fn().mockResolvedValue(""),
  })),
}));

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

const adoSession: AuthSession = {
  provider: "azure-devops",
  accessToken: "ado_oauth_token",
  refreshToken: "ado_refresh",
  expiresAt: Date.now() + 3600_000,
  displayName: "Bob",
  upn: "bob@company.com",
};

const githubPatSession: AuthSession = {
  provider: "pat",
  platform: "github",
  accessToken: "ghp_pat123",
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
  it("builds a tokenless github url", () => {
    expect(remoteUrl(githubRef)).toBe("https://github.com/acme/api.git");
  });

  it("builds a tokenless azure devops url", () => {
    expect(remoteUrl(adoRef)).toBe("https://dev.azure.com/myorg/myproj/_git/myrepo");
  });

  it("does not contain any credential pattern", () => {
    const ghUrl = remoteUrl(githubRef);
    const adoUrl = remoteUrl(adoRef);
    expect(ghUrl).not.toMatch(/@/);
    expect(adoUrl).not.toMatch(/@/);
  });
});

// ── authHeader ────────────────────────────────────────────────────────────────

describe("authHeader", () => {
  it("github session → basic x-access-token:<token>", () => {
    const header = authHeader(githubSession);
    expect(header).toBe(`basic ${Buffer.from("x-access-token:ghp_token").toString("base64")}`);
  });

  it("azure-devops session → Bearer <token>", () => {
    expect(authHeader(adoSession)).toBe("Bearer ado_oauth_token");
  });

  it("pat session (platform azure-devops) → basic :<token>", () => {
    const header = authHeader(patSession);
    expect(header).toBe(`basic ${Buffer.from(":pat123").toString("base64")}`);
  });

  it("pat session (platform github) → basic x-access-token:<token>", () => {
    const header = authHeader(githubPatSession);
    expect(header).toBe(`basic ${Buffer.from("x-access-token:ghp_pat123").toString("base64")}`);
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

// ── disk safety: no token in URL passed to git clone ─────────────────────────

describe("RepoCache disk safety", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "vigil-disksafety-test-"));
    cloneSpy.mockReset();
    cloneSpy.mockImplementation((_url: string, dest: string) => {
      mkdirSync(join(dest, ".git"), { recursive: true });
      return Promise.resolve();
    });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("passes a tokenless URL to git clone", async () => {
    const cache = new RepoCache(tmpDir);
    // @ts-expect-error — bypass git version check
    cache.gitCheckPromise = Promise.resolve(true);
    cache.ensureCloned(githubSession, githubRef);

    await vi.waitFor(() => {
      if (!cloneSpy.mock.calls.length) throw new Error("clone not called yet");
    });

    const [capturedUrl] = cloneSpy.mock.calls[0]!;
    expect(capturedUrl).not.toMatch(/@/);
    expect(capturedUrl).not.toContain("ghp_token");
    expect(capturedUrl).toBe("https://github.com/acme/api.git");
  });
});
