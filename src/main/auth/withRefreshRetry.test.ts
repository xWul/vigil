import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { err, ok } from "../../shared/result.js";
import type { Result } from "../../shared/result.js";
import type { AuthSession, AzureDevOpsSession } from "./AuthProvider.js";
import type { TokenStore } from "./TokenStore.js";
import { withRefreshRetry } from "./withRefreshRetry.js";

interface MockTokenStore extends TokenStore {
  save: Mock;
  load: Mock;
  delete: Mock;
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface FakeError {
  code: "unauthorized" | "not_found";
}

const isUnauthorized = (e: FakeError) => e.code === "unauthorized";

const SESSION: AzureDevOpsSession = {
  provider: "azure-devops",
  accessToken: "at_original",
  refreshToken: "rt_original",
  expiresAt: Date.now() - 1000,
  displayName: "Ada",
  upn: "ada@example.com",
};

const REFRESHED_SESSION: AzureDevOpsSession = {
  ...SESSION,
  accessToken: "at_refreshed",
  refreshToken: "rt_refreshed",
  expiresAt: Date.now() + 3_600_000,
};

function makeTokenStore(): MockTokenStore {
  const data = new Map<string, AuthSession>();
  return {
    save: vi.fn((key: string, s: AuthSession) => {
      data.set(key, s);
      return Promise.resolve();
    }),
    load: vi.fn((key: string) => Promise.resolve(data.get(key) ?? null)),
    delete: vi.fn((key: string) => {
      data.delete(key);
      return Promise.resolve();
    }),
  };
}

function makeProvider(refreshedSession: AuthSession = REFRESHED_SESSION) {
  return {
    id: "azure-devops" as const,
    signIn: vi.fn(),
    refresh: vi.fn(() => Promise.resolve(ok(refreshedSession))),
    signOut: vi.fn(),
  };
}

type Call = (session: AuthSession) => Promise<Result<string, FakeError>>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("withRefreshRetry()", () => {
  it("first call succeeds: returned immediately, no refresh", async () => {
    const call: Call = vi.fn(() => Promise.resolve(ok("data")));
    const provider = makeProvider();

    const result = await withRefreshRetry(
      SESSION,
      provider,
      makeTokenStore(),
      "azure-devops",
      call,
      isUnauthorized,
    );

    expect(result).toEqual({ ok: true, value: "data" });
    expect(provider.refresh).not.toHaveBeenCalled();
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("non-unauthorized error: returned immediately, no refresh", async () => {
    const call: Call = vi.fn(() => Promise.resolve(err({ code: "not_found" as const })));
    const provider = makeProvider();

    const result = await withRefreshRetry(
      SESSION,
      provider,
      makeTokenStore(),
      "azure-devops",
      call,
      isUnauthorized,
    );

    expect(result).toEqual({ ok: false, error: { code: "not_found" } });
    expect(provider.refresh).not.toHaveBeenCalled();
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("unauthorized → refresh succeeds → retry succeeds: returns retry result", async () => {
    const call: Call = vi
      .fn()
      .mockResolvedValueOnce(err({ code: "unauthorized" }))
      .mockResolvedValueOnce(ok("data after refresh"));
    const provider = makeProvider();

    const result = await withRefreshRetry(
      SESSION,
      provider,
      makeTokenStore(),
      "azure-devops",
      call,
      isUnauthorized,
    );

    expect(result).toEqual({ ok: true, value: "data after refresh" });
    expect(provider.refresh).toHaveBeenCalledOnce();
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("unauthorized → refresh succeeds → persists refreshed session", async () => {
    const call: Call = vi
      .fn()
      .mockResolvedValueOnce(err({ code: "unauthorized" }))
      .mockResolvedValueOnce(ok("ok"));
    const tokenStore = makeTokenStore();

    await withRefreshRetry(
      SESSION,
      makeProvider(),
      tokenStore,
      "azure-devops",
      call,
      isUnauthorized,
    );

    expect(tokenStore.save).toHaveBeenCalledWith("azure-devops", REFRESHED_SESSION);
  });

  it("unauthorized → refresh succeeds → retry receives refreshed session", async () => {
    const call: Call = vi
      .fn()
      .mockResolvedValueOnce(err({ code: "unauthorized" }))
      .mockResolvedValueOnce(ok("ok"));

    await withRefreshRetry(
      SESSION,
      makeProvider(),
      makeTokenStore(),
      "azure-devops",
      call,
      isUnauthorized,
    );

    const secondCallSession = ((call as unknown as Mock).mock.calls[1] as [AuthSession])[0];
    expect(secondCallSession.accessToken).toBe("at_refreshed");
  });

  it("unauthorized → refresh fails: returns auth error, no retry", async () => {
    const call: Call = vi.fn(() => Promise.resolve(err({ code: "unauthorized" as const })));
    const provider = {
      ...makeProvider(),
      refresh: vi.fn(() => Promise.resolve(err({ code: "refresh_expired" as const }))),
    };

    const result = await withRefreshRetry(
      SESSION,
      provider,
      makeTokenStore(),
      "azure-devops",
      call,
      isUnauthorized,
    );

    expect(result).toEqual({ ok: false, error: { code: "refresh_expired" } });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("unauthorized → refresh succeeds → retry also unauthorized: returns retry result, no second refresh", async () => {
    const call: Call = vi
      .fn()
      .mockResolvedValueOnce(err({ code: "unauthorized" }))
      .mockResolvedValueOnce(err({ code: "unauthorized" }));
    const provider = makeProvider();

    const result = await withRefreshRetry(
      SESSION,
      provider,
      makeTokenStore(),
      "azure-devops",
      call,
      isUnauthorized,
    );

    expect(result).toEqual({ ok: false, error: { code: "unauthorized" } });
    expect(provider.refresh).toHaveBeenCalledOnce();
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("isUnauthorized returning false suppresses refresh", async () => {
    const call: Call = vi.fn(() => Promise.resolve(err({ code: "unauthorized" as const })));
    const provider = makeProvider();

    await withRefreshRetry(SESSION, provider, makeTokenStore(), "azure-devops", call, () => false);

    expect(provider.refresh).not.toHaveBeenCalled();
    expect(call).toHaveBeenCalledTimes(1);
  });
});
