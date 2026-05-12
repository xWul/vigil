import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import type { AuthenticationResult } from "@azure/msal-node";
import type { PublicClientApplication } from "@azure/msal-node";

import type { AuthSession, AzureDevOpsSession } from "./AuthProvider.js";
import {
  AzureDevOpsAuthProvider,
  AZURE_CLIENT_ID,
  type CallbackListenerFn,
} from "./AzureDevOpsAuthProvider.js";
import { describeAuthProviderContract } from "./authProviderContract.js";
import type { TokenStore } from "./TokenStore.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const FAKE_SESSION: AzureDevOpsSession = {
  provider: "azure-devops",
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresAt: Date.now() + 3_600_000,
  displayName: "Ada Lovelace",
  upn: "ada@example.com",
};

// Retain the vi.fn() Mock type on each method so expect(store.save) doesn't
// trigger @typescript-eslint/unbound-method.
interface MockTokenStore extends TokenStore {
  save: Mock;
  load: Mock;
  delete: Mock;
}

function makeTokenStore(): MockTokenStore {
  const data = new Map<string, AzureDevOpsSession>();
  return {
    save: vi.fn((key: string, session: AuthSession) => {
      data.set(key, session as AzureDevOpsSession);
      return Promise.resolve();
    }),
    load: vi.fn((key: string) => Promise.resolve<AuthSession | null>(data.get(key) ?? null)),
    delete: vi.fn((key: string) => {
      data.delete(key);
      return Promise.resolve();
    }),
  };
}

function makeMsalResult(overrides?: Partial<AuthenticationResult>): AuthenticationResult {
  return {
    authority: "https://login.microsoftonline.com/common",
    uniqueId: "uid-1",
    tenantId: "tid-1",
    scopes: ["vso.profile"],
    account: {
      homeAccountId: "home-1",
      environment: "login.microsoftonline.com",
      tenantId: "tid-1",
      username: "ada@example.com",
      localAccountId: "local-1",
      name: "Ada Lovelace",
      idTokenClaims: {},
      nativeAccountId: undefined,
      authorityType: "MSSTS",
      tenantProfiles: new Map(),
    },
    idToken: "id-token",
    idTokenClaims: {},
    accessToken: "new-access-token",
    fromCache: false,
    expiresOn: new Date(Date.now() + 3_600_000),
    tokenType: "Bearer",
    correlationId: "corr-1",
    ...overrides,
  } as AuthenticationResult;
}

// Retain the vi.fn() Mock type so expect(client.method) doesn't trigger
// @typescript-eslint/unbound-method.
interface MockMsalClient {
  getAuthCodeUrl: Mock;
  acquireTokenByCode: Mock;
  acquireTokenByRefreshToken: Mock;
  getTokenCache: Mock;
}

function makeMsalClient(
  overrides: {
    getAuthCodeUrl?: () => Promise<string>;
    acquireTokenByCode?: () => Promise<AuthenticationResult | null>;
    acquireTokenByRefreshToken?: () => Promise<AuthenticationResult | null>;
    cacheRefreshToken?: string;
  } = {},
): MockMsalClient {
  const cacheRefreshToken = overrides.cacheRefreshToken ?? "new-refresh-token";
  const mockCache = {
    serialize: vi.fn(() =>
      JSON.stringify({
        Account: {},
        IdToken: {},
        AccessToken: {},
        RefreshToken: { key1: { secret: cacheRefreshToken } },
        AppMetadata: {},
      }),
    ),
  };

  return {
    getAuthCodeUrl: vi.fn(
      overrides.getAuthCodeUrl ?? (() => Promise.resolve("https://login.microsoftonline.com/auth")),
    ),
    acquireTokenByCode: vi.fn(
      overrides.acquireTokenByCode ?? (() => Promise.resolve(makeMsalResult())),
    ),
    acquireTokenByRefreshToken: vi.fn(
      overrides.acquireTokenByRefreshToken ?? (() => Promise.resolve(makeMsalResult())),
    ),
    getTokenCache: vi.fn(() => mockCache),
  };
}

function asMsal(mock: MockMsalClient): PublicClientApplication {
  return mock as unknown as PublicClientApplication;
}

function makeInstantListener(code: string): CallbackListenerFn {
  return vi.fn(() =>
    Promise.resolve({
      redirectUri: "http://localhost:12345/callback",
      result: Promise.resolve<
        { ok: true; code: string } | { ok: false; error: string; description: string }
      >({ ok: true, code }),
    }),
  );
}

function makeErrorListener(error: string, description = ""): CallbackListenerFn {
  return vi.fn(() =>
    Promise.resolve({
      redirectUri: "http://localhost:12345/callback",
      result: Promise.resolve<
        { ok: true; code: string } | { ok: false; error: string; description: string }
      >({ ok: false, error, description }),
    }),
  );
}

// ---------------------------------------------------------------------------
// Contract tests
// ---------------------------------------------------------------------------

describeAuthProviderContract("AzureDevOpsAuthProvider (contract)", () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

  const msalMock = makeMsalClient();
  const provider = new AzureDevOpsAuthProvider(
    makeTokenStore(),
    vi.fn(() => Promise.resolve()),
    () => asMsal(msalMock),
    makeInstantListener("contract-code"),
  );

  return { provider, session: FAKE_SESSION };
});

// ---------------------------------------------------------------------------
// Unit tests — signIn()
// ---------------------------------------------------------------------------

describe("AzureDevOpsAuthProvider.signIn()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("happy path: opens browser, exchanges code, persists session", async () => {
    const tokenStore = makeTokenStore();
    const openBrowser = vi.fn(() => Promise.resolve());
    const msalMock = makeMsalClient();
    const listener = makeInstantListener("auth-code-123");

    const provider = new AzureDevOpsAuthProvider(
      tokenStore,
      openBrowser,
      () => asMsal(msalMock),
      listener,
    );

    const result = await provider.signIn();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.provider !== "azure-devops") return;

    expect(result.value.accessToken).toBe("new-access-token");
    expect(result.value.refreshToken).toBe("new-refresh-token");
    expect(result.value.displayName).toBe("Ada Lovelace");
    expect(result.value.upn).toBe("ada@example.com");

    expect(openBrowser).toHaveBeenCalledOnce();
    expect(msalMock.acquireTokenByCode).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "auth-code-123",
        redirectUri: "http://localhost:12345/callback",
      }),
    );
    expect(tokenStore.save).toHaveBeenCalledWith("azure-devops", result.value);
  });

  it("timeout: returns { code: 'timeout' }", async () => {
    const provider = new AzureDevOpsAuthProvider(
      makeTokenStore(),
      vi.fn(() => Promise.resolve()),
      () => asMsal(makeMsalClient()),
      makeErrorListener("timeout"),
    );

    const result = await provider.signIn();
    expect(result).toEqual({ ok: false, error: { code: "timeout" } });
  });

  it("access_denied: returns { code: 'consent_denied' }", async () => {
    const provider = new AzureDevOpsAuthProvider(
      makeTokenStore(),
      vi.fn(() => Promise.resolve()),
      () => asMsal(makeMsalClient()),
      makeErrorListener("access_denied", "User denied consent"),
    );

    const result = await provider.signIn();
    expect(result).toEqual({ ok: false, error: { code: "consent_denied" } });
  });

  it("other OAuth error: returns { code: 'auth_failed' }", async () => {
    const provider = new AzureDevOpsAuthProvider(
      makeTokenStore(),
      vi.fn(() => Promise.resolve()),
      () => asMsal(makeMsalClient()),
      makeErrorListener("server_error", "Something went wrong"),
    );

    const result = await provider.signIn();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("auth_failed");
  });

  it("acquireTokenByCode failure: returns { code: 'auth_failed' }", async () => {
    const msalMock = makeMsalClient({
      acquireTokenByCode: () => {
        throw Object.assign(new Error("token_request_context_error"), {
          errorCode: "token_request_context_error",
        });
      },
    });

    const provider = new AzureDevOpsAuthProvider(
      makeTokenStore(),
      vi.fn(() => Promise.resolve()),
      () => asMsal(msalMock),
      makeInstantListener("code-123"),
    );

    const result = await provider.signIn();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("auth_failed");
  });

  it("includes PKCE challenge in getAuthCodeUrl call", async () => {
    const msalMock = makeMsalClient();

    const provider = new AzureDevOpsAuthProvider(
      makeTokenStore(),
      vi.fn(() => Promise.resolve()),
      () => asMsal(msalMock),
      makeInstantListener("code-pkce"),
    );

    await provider.signIn();

    const firstCallArgs = msalMock.getAuthCodeUrl.mock.calls[0] as
      | [{ codeChallengeMethod: string; codeChallenge: string }]
      | undefined;
    expect(firstCallArgs?.[0]?.codeChallengeMethod).toBe("S256");
    expect(firstCallArgs?.[0]?.codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

// ---------------------------------------------------------------------------
// Unit tests — refresh()
// ---------------------------------------------------------------------------

describe("AzureDevOpsAuthProvider.refresh()", () => {
  it("happy path: returns updated session with new tokens", async () => {
    const tokenStore = makeTokenStore();
    const msalMock = makeMsalClient({ cacheRefreshToken: "rotated-refresh-token" });

    const provider = new AzureDevOpsAuthProvider(
      tokenStore,
      vi.fn(() => Promise.resolve()),
      () => asMsal(msalMock),
    );

    const result = await provider.refresh(FAKE_SESSION);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.provider !== "azure-devops") return;

    expect(result.value.accessToken).toBe("new-access-token");
    expect(result.value.refreshToken).toBe("rotated-refresh-token");
    expect(tokenStore.save).toHaveBeenCalledWith("azure-devops", result.value);
  });

  it("passes stored refresh token to MSAL", async () => {
    const msalMock = makeMsalClient();

    const provider = new AzureDevOpsAuthProvider(
      makeTokenStore(),
      vi.fn(() => Promise.resolve()),
      () => asMsal(msalMock),
    );

    await provider.refresh(FAKE_SESSION);

    expect(msalMock.acquireTokenByRefreshToken).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: FAKE_SESSION.refreshToken }),
    );
  });

  it("invalid_grant: returns { code: 'refresh_expired' }", async () => {
    const msalMock = makeMsalClient({
      acquireTokenByRefreshToken: () => {
        throw Object.assign(new Error("Refresh token expired"), {
          errorCode: "invalid_grant",
        });
      },
    });

    const provider = new AzureDevOpsAuthProvider(
      makeTokenStore(),
      vi.fn(() => Promise.resolve()),
      () => asMsal(msalMock),
    );

    const result = await provider.refresh(FAKE_SESSION);
    expect(result).toEqual({ ok: false, error: { code: "refresh_expired" } });
  });

  it("null result from MSAL: returns { code: 'refresh_expired' }", async () => {
    const msalMock = makeMsalClient({
      acquireTokenByRefreshToken: () => Promise.resolve(null),
    });

    const provider = new AzureDevOpsAuthProvider(
      makeTokenStore(),
      vi.fn(() => Promise.resolve()),
      () => asMsal(msalMock),
    );

    const result = await provider.refresh(FAKE_SESSION);
    expect(result).toEqual({ ok: false, error: { code: "refresh_expired" } });
  });

  it("network error: returns { code: 'network' }", async () => {
    const msalMock = makeMsalClient({
      acquireTokenByRefreshToken: () => {
        throw Object.assign(new Error("ENOTFOUND login.microsoftonline.com"), {
          errorCode: "network_error",
        });
      },
    });

    const provider = new AzureDevOpsAuthProvider(
      makeTokenStore(),
      vi.fn(() => Promise.resolve()),
      () => asMsal(msalMock),
    );

    const result = await provider.refresh(FAKE_SESSION);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("network");
  });

  it("wrong provider session: returns { code: 'auth_failed' }", async () => {
    const provider = new AzureDevOpsAuthProvider(
      makeTokenStore(),
      vi.fn(() => Promise.resolve()),
      () => asMsal(makeMsalClient()),
    );

    const result = await provider.refresh({
      provider: "github",
      accessToken: "gh-token",
      displayName: "Ada",
      login: "ada",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("auth_failed");
  });
});

// ---------------------------------------------------------------------------
// Unit tests — signOut()
// ---------------------------------------------------------------------------

describe("AzureDevOpsAuthProvider.signOut()", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("happy path: deletes keychain entry and returns success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const tokenStore = makeTokenStore();
    await tokenStore.save("azure-devops", FAKE_SESSION);

    const provider = new AzureDevOpsAuthProvider(
      tokenStore,
      vi.fn(() => Promise.resolve()),
      () => asMsal(makeMsalClient()),
    );

    const result = await provider.signOut(FAKE_SESSION);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(tokenStore.delete).toHaveBeenCalledWith("azure-devops");
    expect(await tokenStore.load("azure-devops")).toBeNull();
  });

  it("revocation failure: still succeeds and removes local session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const tokenStore = makeTokenStore();

    const provider = new AzureDevOpsAuthProvider(
      tokenStore,
      vi.fn(() => Promise.resolve()),
      () => asMsal(makeMsalClient()),
    );

    const result = await provider.signOut(FAKE_SESSION);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(tokenStore.delete).toHaveBeenCalledWith("azure-devops");
  });

  it("sends logout hint to revocation endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new AzureDevOpsAuthProvider(
      makeTokenStore(),
      vi.fn(() => Promise.resolve()),
      () => asMsal(makeMsalClient()),
    );

    await provider.signOut(FAKE_SESSION);

    const [url, init] = (fetchMock.mock.calls[0] ?? []) as [string, RequestInit];
    expect(url).toContain("login.microsoftonline.com");
    expect(init.method).toBe("POST");

    const body = typeof init.body === "string" ? init.body : "";
    expect(body).toContain(AZURE_CLIENT_ID);
    expect(body).toContain("ada%40example.com");
  });

  it("wrong provider session: returns { code: 'auth_failed' }", async () => {
    const provider = new AzureDevOpsAuthProvider(
      makeTokenStore(),
      vi.fn(() => Promise.resolve()),
      () => asMsal(makeMsalClient()),
    );

    const result = await provider.signOut({
      provider: "github",
      accessToken: "gh-token",
      displayName: "Ada",
      login: "ada",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("auth_failed");
  });
});
