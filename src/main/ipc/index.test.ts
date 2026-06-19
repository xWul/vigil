import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

// ---------------------------------------------------------------------------
// Electron mock — must come before the import of registerHandlers
// ---------------------------------------------------------------------------

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, (...args: unknown[]) => fn(undefined, ...args));
    },
  },
  app: {
    getVersion: () => "0.0.0-test",
    getPath: () => "/tmp/vigil-test-unused",
  },
  BrowserWindow: { getAllWindows: () => [] },
  clipboard: { writeText: vi.fn() },
  dialog: { showMessageBox: vi.fn() },
  shell: { openExternal: vi.fn() },
  Notification: Object.assign(vi.fn(), { isSupported: () => false }),
}));

// ---------------------------------------------------------------------------
// Application imports (after the electron mock is registered)
// ---------------------------------------------------------------------------

import { registerHandlers } from "./index.js";
import { FileTokenStore } from "../auth/FileTokenStore.js";
import { FileSecretStore } from "../settings/SecretStore.js";
import { SettingsStore } from "../settings/SettingsStore.js";
import { ReviewCache } from "../ai/ReviewCache.js";
import { RepoCache } from "../git/RepoCache.js";
import { NoopLogger } from "../../shared/logger.js";
import type { AuthSession } from "../auth/AuthProvider.js";
import type { PRRef } from "../../shared/model/index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GITHUB_REF: PRRef = {
  platform: "github",
  owner: "acmecorp",
  repo: "backend",
  number: 42,
};

const GITHUB_SESSION: AuthSession = {
  provider: "github",
  accessToken: "gho_test_token",
  displayName: "Ada Lovelace",
  login: "ada",
};

// ---------------------------------------------------------------------------
// MSW server — minimal stubs for listPRs happy path
// ---------------------------------------------------------------------------

const SEARCH_RESPONSE = {
  total_count: 1,
  incomplete_results: false,
  items: [
    {
      id: 1,
      node_id: "PR_1",
      url: "https://api.github.com/repos/acmecorp/backend/issues/42",
      repository_url: "https://api.github.com/repos/acmecorp/backend",
      html_url: "https://github.com/acmecorp/backend/pull/42",
      number: 42,
      title: "Fix authentication bug",
      state: "open",
      draft: false,
      body: "Closes #41",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
      user: { login: "ada", id: 1, node_id: "MDQ6VXNlcjE=", type: "User", site_admin: false },
      pull_request: { merged_at: null },
    },
  ],
};

const PR_DETAIL = {
  number: 42,
  title: "Fix authentication bug",
  body: "Closes #41",
  state: "open",
  draft: false,
  html_url: "https://github.com/acmecorp/backend/pull/42",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  user: { login: "ada", id: 1, node_id: "MDQ6VXNlcjE=", type: "User", site_admin: false },
  base: { ref: "main" },
  head: { ref: "fix/auth", sha: "abc123" },
  merged: false,
  mergeable: true,
  rebaseable: true,
  mergeable_state: "clean",
  merged_by: null,
  comments: 0,
  review_comments: 0,
  maintainer_can_modify: false,
  commits: 1,
  additions: 5,
  deletions: 2,
  changed_files: 1,
};

const server = setupServer(
  http.get("https://api.github.com/search/issues", () => HttpResponse.json(SEARCH_RESPONSE)),
  http.get("https://api.github.com/repos/acmecorp/backend/pulls/42", () =>
    HttpResponse.json(PR_DETAIL),
  ),
  http.get("https://api.github.com/repos/acmecorp/backend/pulls/42/files", () =>
    HttpResponse.json([]),
  ),
  http.get("https://api.github.com/repos/acmecorp/backend/issues/42/comments", () =>
    HttpResponse.json([]),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let tmpDir: string;

function setup() {
  tmpDir = mkdtempSync(join(tmpdir(), "vigil-ipc-test-"));
  handlers.clear();

  const tokenStore = new FileTokenStore(join(tmpDir, "tokens.json"));
  const secretStore = new FileSecretStore(join(tmpDir, "secrets.json"));
  const settingsStore = new SettingsStore(join(tmpDir, "settings.json"), secretStore);
  const reviewCache = new ReviewCache(join(tmpDir, "review-cache"));
  const repoCache = new RepoCache(join(tmpDir, "repo-cache"));

  // registerHandlers is a registration-time side effect; the handlers map-mock
  // means each call simply overwrites the previous registration, which is fine
  // for isolated per-test closures.
  registerHandlers(tokenStore, settingsStore, new NoopLogger(), reviewCache, repoCache, null);

  function invoke(channel: string, ...args: unknown[]) {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`No IPC handler registered for: ${channel}`);
    return handler(...args) as Promise<Record<string, unknown>>;
  }

  return { tokenStore, settingsStore, reviewCache, invoke };
}

beforeEach(() => {
  // tmpDir is assigned inside setup(); reset to empty so afterEach is safe
  // even if a test didn't call setup().
  tmpDir = "";
});

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Smoke test
// ---------------------------------------------------------------------------

it("app:getVersion returns ok with the mocked version string", async () => {
  const { invoke } = setup();
  const result = await invoke("app:getVersion");
  expect(result).toEqual({ ok: true, value: "0.0.0-test" });
});

// ---------------------------------------------------------------------------
// Auth family
// ---------------------------------------------------------------------------

describe("auth", () => {
  it("getAccounts with empty token store returns ok([])", async () => {
    const { invoke } = setup();
    const result = await invoke("auth:getAccounts");
    expect(result).toEqual({ ok: true, value: [] });
  });

  it("getAccounts with seeded github session returns account without the token", async () => {
    const { tokenStore, invoke } = setup();
    await tokenStore.save("github", GITHUB_SESSION);

    const result = await invoke("auth:getAccounts");
    expect(result).toMatchObject({
      ok: true,
      value: [{ platform: "github", displayName: "Ada Lovelace", login: "ada" }],
    });
    // Security property: the raw token must not appear anywhere in the payload
    expect(JSON.stringify(result)).not.toContain("gho_test_token");
  });

  it("getAccounts finds a PAT session via the pat-<platform> fallback key", async () => {
    const { tokenStore, invoke } = setup();
    const pat: AuthSession = { provider: "pat", platform: "github", accessToken: "ghp_pat" };
    await tokenStore.save("pat-github", pat);

    const result = await invoke("auth:getAccounts");
    expect(result).toMatchObject({
      ok: true,
      value: [{ platform: "github", login: "pat" }],
    });
  });

  it("signOut with no stored session is idempotent and returns ok", async () => {
    const { invoke } = setup();
    const result = await invoke("auth:signOut", "github");
    expect(result).toEqual({ ok: true, value: undefined });
  });
});

// ---------------------------------------------------------------------------
// Platform family
// ---------------------------------------------------------------------------

describe("platform", () => {
  it("getPRWithDiff with no session returns forbidden", async () => {
    const { invoke } = setup();
    const result = await invoke("platform:getPRWithDiff", GITHUB_REF);
    expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });

  it("listPRs with no sessions returns ok([])", async () => {
    const { invoke } = setup();
    const result = await invoke("platform:listPRs");
    expect(result).toEqual({ ok: true, value: [] });
  });

  it("listPRs with a seeded github session returns PRs from the MSW-stubbed API", async () => {
    const { tokenStore, invoke } = setup();
    await tokenStore.save("github", GITHUB_SESSION);

    const result = await invoke("platform:listPRs");
    expect(result).toMatchObject({ ok: true });
    expect(Array.isArray((result as { value: unknown }).value)).toBe(true);
    expect((result as { value: unknown[] }).value.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Review family
// ---------------------------------------------------------------------------

describe("review", () => {
  it("getCached for an unknown sha returns ok(null)", async () => {
    const { invoke } = setup();
    const result = await invoke("review:getCached", GITHUB_REF, "unknown-sha");
    expect(result).toEqual({ ok: true, value: null });
  });

  it("invalidate then getCached is still a miss", async () => {
    const { invoke } = setup();
    await invoke("review:invalidate", GITHUB_REF, "some-sha");
    const result = await invoke("review:getCached", GITHUB_REF, "some-sha");
    expect(result).toEqual({ ok: true, value: null });
  });

  it("run with no session returns a network error", async () => {
    const { invoke } = setup();
    const result = await invoke("review:run", GITHUB_REF);
    expect(result).toMatchObject({ ok: false, error: { code: "network" } });
  });
});

// ---------------------------------------------------------------------------
// Settings family
// ---------------------------------------------------------------------------

describe("settings", () => {
  it("get on a fresh store returns defaults with no AI keys configured", async () => {
    const { invoke } = setup();
    const result = await invoke("settings:get");
    expect(result).toMatchObject({
      ok: true,
      value: { hasAnthropicKey: false, hasOpenAIKey: false },
    });
  });

  it("setApiKey then get reflects hasAnthropicKey: true without the key in the payload", async () => {
    const { invoke } = setup();
    await invoke("settings:setApiKey", "anthropic", "test-key-123");

    const result = await invoke("settings:get");
    expect(result).toMatchObject({ ok: true, value: { hasAnthropicKey: true } });
    // Security property: the API key must never appear in the renderer payload
    expect(JSON.stringify(result)).not.toContain("test-key-123");
  });

  it("setAnalyzerConfig + getAnalyzerConfig round-trips the config", async () => {
    const { invoke } = setup();
    const config = { complexity: { enabled: false, cyclomaticThreshold: 20 } };
    await invoke("settings:setAnalyzerConfig", GITHUB_REF, config);

    const result = await invoke("settings:getAnalyzerConfig", GITHUB_REF);
    expect(result).toMatchObject({ ok: true, value: config });
  });
});
