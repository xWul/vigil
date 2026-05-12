import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import type { AuthSession, GitHubSession } from "./AuthProvider.js";
import {
  GitHubAuthProvider,
  GITHUB_CLIENT_ID,
  type FetchFn,
  type SleepFn,
} from "./GitHubAuthProvider.js";
import { describeAuthProviderContract } from "./authProviderContract.js";
import type { TokenStore } from "./TokenStore.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const FAKE_SESSION: GitHubSession = {
  provider: "github",
  accessToken: "gho_testtoken",
  login: "ada",
  displayName: "Ada Lovelace",
};

interface MockTokenStore extends TokenStore {
  save: Mock;
  load: Mock;
  delete: Mock;
}

function makeTokenStore(): MockTokenStore {
  const data = new Map<string, GitHubSession>();
  return {
    save: vi.fn((key: string, session: AuthSession) => {
      data.set(key, session as GitHubSession);
      return Promise.resolve();
    }),
    load: vi.fn((key: string) => Promise.resolve<AuthSession | null>(data.get(key) ?? null)),
    delete: vi.fn((key: string) => {
      data.delete(key);
      return Promise.resolve();
    }),
  };
}

const noopSleep: SleepFn = vi.fn(() => Promise.resolve());

// Builds a FetchFn mock that handles device code, poll, and user requests in
// a single call sequence.
function makeHappyPathFetch(
  overrides: {
    userName?: string | null;
    pollSequence?: { error: string }[];
  } = {},
): FetchFn {
  const { userName = "Ada Lovelace", pollSequence = [] } = overrides;
  let pollCallIndex = 0;

  return vi.fn((url: Parameters<FetchFn>[0]) => {
    const urlStr = url instanceof Request ? url.url : String(url);

    if (urlStr.includes("device/code")) {
      return Promise.resolve(
        makeJsonResponse({
          device_code: "dev-code-abc",
          user_code: "ABCD-1234",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 5,
        }),
      );
    }

    if (urlStr.includes("access_token")) {
      const pending = pollSequence[pollCallIndex];
      pollCallIndex++;
      if (pending) {
        return Promise.resolve(makeJsonResponse({ error: pending.error }));
      }
      return Promise.resolve(
        makeJsonResponse({ access_token: "gho_newtoken", token_type: "bearer", scope: "repo" }),
      );
    }

    if (urlStr.includes("api.github.com/user")) {
      return Promise.resolve(makeJsonResponse({ login: "ada", name: userName }));
    }

    return Promise.resolve(makeJsonResponse({}));
  }) as unknown as FetchFn;
}

function makeJsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Contract tests
// ---------------------------------------------------------------------------

describeAuthProviderContract("GitHubAuthProvider (contract)", () => {
  const provider = new GitHubAuthProvider(
    makeTokenStore(),
    vi.fn(() => Promise.resolve()),
    makeHappyPathFetch(),
    noopSleep,
  );
  return { provider, session: FAKE_SESSION };
});

// ---------------------------------------------------------------------------
// Unit tests — signIn()
// ---------------------------------------------------------------------------

describe("GitHubAuthProvider.signIn()", () => {
  it("happy path: requests device code, polls, fetches user, persists session", async () => {
    const tokenStore = makeTokenStore();
    const presentDeviceCode = vi.fn(() => Promise.resolve());
    const fetchFn = makeHappyPathFetch();

    const provider = new GitHubAuthProvider(tokenStore, presentDeviceCode, fetchFn, noopSleep);
    const result = await provider.signIn();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.provider !== "github") return;

    expect(result.value.accessToken).toBe("gho_newtoken");
    expect(result.value.login).toBe("ada");
    expect(result.value.displayName).toBe("Ada Lovelace");

    expect(presentDeviceCode).toHaveBeenCalledWith("ABCD-1234", "https://github.com/login/device");
    expect(tokenStore.save).toHaveBeenCalledWith("github", result.value);
  });

  it("includes client_id in device code request", async () => {
    const fetchFn = makeHappyPathFetch();

    const provider = new GitHubAuthProvider(
      makeTokenStore(),
      vi.fn(() => Promise.resolve()),
      fetchFn,
      noopSleep,
    );
    await provider.signIn();

    const firstCall = (fetchFn as Mock).mock.calls[0] as [string, RequestInit] | undefined;
    const rawBody = firstCall?.[1]?.body;
    const body = typeof rawBody === "string" ? rawBody : "";
    expect(body).toContain(GITHUB_CLIENT_ID);
    expect(body).toContain("repo");
  });

  it("authorization_pending: keeps polling until success", async () => {
    const fetchFn = makeHappyPathFetch({
      pollSequence: [{ error: "authorization_pending" }, { error: "authorization_pending" }],
    });

    const provider = new GitHubAuthProvider(
      makeTokenStore(),
      vi.fn(() => Promise.resolve()),
      fetchFn,
      noopSleep,
    );
    const result = await provider.signIn();

    expect(result.ok).toBe(true);
    // device code + 3 poll calls (2 pending + 1 success) + user
    expect((fetchFn as Mock).mock.calls).toHaveLength(5);
  });

  it("slow_down: adds 5 s to interval and keeps polling", async () => {
    const sleepFn: SleepFn = vi.fn(() => Promise.resolve());
    const fetchFn = makeHappyPathFetch({ pollSequence: [{ error: "slow_down" }] });

    const provider = new GitHubAuthProvider(
      makeTokenStore(),
      vi.fn(() => Promise.resolve()),
      fetchFn,
      sleepFn,
    );
    await provider.signIn();

    const sleepCalls = (sleepFn as Mock).mock.calls as [number][];
    // First poll uses the original interval (5 s → 5000 ms),
    // second poll adds 5 s → 10000 ms.
    expect(sleepCalls[0]?.[0]).toBe(5_000);
    expect(sleepCalls[1]?.[0]).toBe(10_000);
  });

  it("expired_token: returns { code: 'timeout' }", async () => {
    const errorFetch: FetchFn = vi.fn((url: Parameters<FetchFn>[0]) => {
      const urlStr = url instanceof Request ? url.url : String(url);
      if (urlStr.includes("device/code")) {
        return Promise.resolve(
          makeJsonResponse({
            device_code: "dev-code",
            user_code: "XXXX-9999",
            verification_uri: "https://github.com/login/device",
            expires_in: 900,
            interval: 5,
          }),
        );
      }
      return Promise.resolve(makeJsonResponse({ error: "expired_token" }));
    }) as unknown as FetchFn;

    const provider = new GitHubAuthProvider(
      makeTokenStore(),
      vi.fn(() => Promise.resolve()),
      errorFetch,
      noopSleep,
    );
    const result = await provider.signIn();
    expect(result).toEqual({ ok: false, error: { code: "timeout" } });
  });

  it("access_denied: returns { code: 'consent_denied' }", async () => {
    const errorFetch: FetchFn = vi.fn((url: Parameters<FetchFn>[0]) => {
      const urlStr = url instanceof Request ? url.url : String(url);
      if (urlStr.includes("device/code")) {
        return Promise.resolve(
          makeJsonResponse({
            device_code: "dev-code",
            user_code: "XXXX-9999",
            verification_uri: "https://github.com/login/device",
            expires_in: 900,
            interval: 5,
          }),
        );
      }
      return Promise.resolve(makeJsonResponse({ error: "access_denied" }));
    }) as unknown as FetchFn;

    const provider = new GitHubAuthProvider(
      makeTokenStore(),
      vi.fn(() => Promise.resolve()),
      errorFetch,
      noopSleep,
    );
    const result = await provider.signIn();
    expect(result).toEqual({ ok: false, error: { code: "consent_denied" } });
  });

  it("GET /user network failure: returns { code: 'network' }", async () => {
    const errorFetch: FetchFn = vi.fn((url: Parameters<FetchFn>[0]) => {
      const urlStr = url instanceof Request ? url.url : String(url);
      if (urlStr.includes("device/code")) {
        return Promise.resolve(
          makeJsonResponse({
            device_code: "dev-code",
            user_code: "XXXX-9999",
            verification_uri: "https://github.com/login/device",
            expires_in: 900,
            interval: 5,
          }),
        );
      }
      if (urlStr.includes("access_token")) {
        return Promise.resolve(
          makeJsonResponse({ access_token: "gho_token", token_type: "bearer", scope: "repo" }),
        );
      }
      return Promise.reject(new Error("ENOTFOUND api.github.com"));
    }) as unknown as FetchFn;

    const provider = new GitHubAuthProvider(
      makeTokenStore(),
      vi.fn(() => Promise.resolve()),
      errorFetch,
      noopSleep,
    );
    const result = await provider.signIn();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("network");
  });

  it("displayName falls back to login when GitHub name is null", async () => {
    const fetchFn = makeHappyPathFetch({ userName: null });

    const provider = new GitHubAuthProvider(
      makeTokenStore(),
      vi.fn(() => Promise.resolve()),
      fetchFn,
      noopSleep,
    );
    const result = await provider.signIn();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.provider !== "github") return;
    expect(result.value.displayName).toBe("ada");
  });
});

// ---------------------------------------------------------------------------
// Unit tests — refresh()
// ---------------------------------------------------------------------------

describe("GitHubAuthProvider.refresh()", () => {
  it("returns the existing session unchanged (no-op)", async () => {
    const provider = new GitHubAuthProvider(
      makeTokenStore(),
      vi.fn(() => Promise.resolve()),
    );
    const result = await provider.refresh(FAKE_SESSION);
    expect(result).toEqual({ ok: true, value: FAKE_SESSION });
  });

  it("makes no network calls", async () => {
    const fetchFn = vi.fn() as unknown as FetchFn;
    const provider = new GitHubAuthProvider(
      makeTokenStore(),
      vi.fn(() => Promise.resolve()),
      fetchFn,
    );
    await provider.refresh(FAKE_SESSION);
    expect((fetchFn as Mock).mock.calls).toHaveLength(0);
  });

  it("wrong provider session: returns { code: 'auth_failed' }", async () => {
    const provider = new GitHubAuthProvider(
      makeTokenStore(),
      vi.fn(() => Promise.resolve()),
    );
    const result = await provider.refresh({
      provider: "azure-devops",
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: Date.now(),
      displayName: "Ada",
      upn: "ada@example.com",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("auth_failed");
  });
});

// ---------------------------------------------------------------------------
// Unit tests — signOut()
// ---------------------------------------------------------------------------

describe("GitHubAuthProvider.signOut()", () => {
  it("deletes the keychain entry and returns success", async () => {
    const tokenStore = makeTokenStore();
    await tokenStore.save("github", FAKE_SESSION);

    const provider = new GitHubAuthProvider(
      tokenStore,
      vi.fn(() => Promise.resolve()),
    );
    const result = await provider.signOut(FAKE_SESSION);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(tokenStore.delete).toHaveBeenCalledWith("github");
    expect(await tokenStore.load("github")).toBeNull();
  });

  it("makes no network calls (local-only sign-out)", async () => {
    const fetchFn = vi.fn() as unknown as FetchFn;
    const provider = new GitHubAuthProvider(
      makeTokenStore(),
      vi.fn(() => Promise.resolve()),
      fetchFn,
    );
    await provider.signOut(FAKE_SESSION);
    expect((fetchFn as Mock).mock.calls).toHaveLength(0);
  });

  it("wrong provider session: returns { code: 'auth_failed' }", async () => {
    const provider = new GitHubAuthProvider(
      makeTokenStore(),
      vi.fn(() => Promise.resolve()),
    );
    const result = await provider.signOut({
      provider: "azure-devops",
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: Date.now(),
      displayName: "Ada",
      upn: "ada@example.com",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("auth_failed");
  });
});
