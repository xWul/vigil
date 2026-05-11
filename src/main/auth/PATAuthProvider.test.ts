import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import type { AuthSession, PATSession } from "./AuthProvider.js";
import { PATAuthProvider, type AskForPATFn } from "./PATAuthProvider.js";
import { describeAuthProviderContract } from "./authProviderContract.js";
import type { TokenStore } from "./TokenStore.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const FAKE_GITHUB_SESSION: PATSession = {
  provider: "pat",
  platform: "github",
  accessToken: "ghp_testtoken",
};

const FAKE_ADO_SESSION: PATSession = {
  provider: "pat",
  platform: "azure-devops",
  accessToken: "ado_testtoken",
};

interface MockTokenStore extends TokenStore {
  save: Mock;
  load: Mock;
  delete: Mock;
}

function makeTokenStore(): MockTokenStore {
  const data = new Map<string, PATSession>();
  return {
    save: vi.fn((key: string, session: AuthSession) => {
      data.set(key, session as PATSession);
      return Promise.resolve();
    }),
    load: vi.fn((key: string) => Promise.resolve<AuthSession | null>(data.get(key) ?? null)),
    delete: vi.fn((key: string) => {
      data.delete(key);
      return Promise.resolve();
    }),
  };
}

// ---------------------------------------------------------------------------
// Contract tests
// ---------------------------------------------------------------------------

describeAuthProviderContract("PATAuthProvider (contract) — github", () => {
  const provider = new PATAuthProvider(
    "github",
    makeTokenStore(),
    vi.fn(() => Promise.resolve("ghp_token")) as unknown as AskForPATFn,
  );
  return { provider, session: FAKE_GITHUB_SESSION };
});

describeAuthProviderContract("PATAuthProvider (contract) — azure-devops", () => {
  const provider = new PATAuthProvider(
    "azure-devops",
    makeTokenStore(),
    vi.fn(() => Promise.resolve("ado_token")) as unknown as AskForPATFn,
  );
  return { provider, session: FAKE_ADO_SESSION };
});

// ---------------------------------------------------------------------------
// Unit tests — signIn()
// ---------------------------------------------------------------------------

describe("PATAuthProvider.signIn()", () => {
  it("happy path: stores PAT and returns PATSession", async () => {
    const tokenStore = makeTokenStore();
    const askForPAT = vi.fn(() => Promise.resolve("ghp_realtoken"));

    const provider = new PATAuthProvider("github", tokenStore, askForPAT as AskForPATFn);
    const result = await provider.signIn();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      provider: "pat",
      platform: "github",
      accessToken: "ghp_realtoken",
    });
    expect(tokenStore.save).toHaveBeenCalledWith("pat-github", result.value);
  });

  it("trims whitespace from the token", async () => {
    const provider = new PATAuthProvider(
      "github",
      makeTokenStore(),
      vi.fn(() => Promise.resolve("  ghp_padded  ")) as AskForPATFn,
    );
    const result = await provider.signIn();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.accessToken).toBe("ghp_padded");
  });

  it("uses the correct keychain key per platform", async () => {
    const githubStore = makeTokenStore();
    const adoStore = makeTokenStore();

    await new PATAuthProvider(
      "github",
      githubStore,
      vi.fn(() => Promise.resolve("ghp_t")) as AskForPATFn,
    ).signIn();
    await new PATAuthProvider(
      "azure-devops",
      adoStore,
      vi.fn(() => Promise.resolve("ado_t")) as AskForPATFn,
    ).signIn();

    expect(githubStore.save).toHaveBeenCalledWith("pat-github", expect.anything());
    expect(adoStore.save).toHaveBeenCalledWith("pat-azure-devops", expect.anything());
  });

  it("askForPAT rejects: returns { code: 'cancelled' }", async () => {
    const provider = new PATAuthProvider(
      "github",
      makeTokenStore(),
      vi.fn(() => Promise.reject(new Error("aborted"))) as AskForPATFn,
    );
    const result = await provider.signIn();
    expect(result).toEqual({ ok: false, error: { code: "cancelled" } });
  });

  it("empty token: returns { code: 'auth_failed' }", async () => {
    const provider = new PATAuthProvider(
      "github",
      makeTokenStore(),
      vi.fn(() => Promise.resolve("   ")) as AskForPATFn,
    );
    const result = await provider.signIn();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("auth_failed");
  });

  it("empty token does not write to token store", async () => {
    const tokenStore = makeTokenStore();
    const provider = new PATAuthProvider(
      "github",
      tokenStore,
      vi.fn(() => Promise.resolve("")) as AskForPATFn,
    );
    await provider.signIn();
    expect(tokenStore.save).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Unit tests — refresh()
// ---------------------------------------------------------------------------

describe("PATAuthProvider.refresh()", () => {
  it("returns the existing session unchanged (no-op)", async () => {
    const provider = new PATAuthProvider(
      "github",
      makeTokenStore(),
      vi.fn() as unknown as AskForPATFn,
    );
    const result = await provider.refresh(FAKE_GITHUB_SESSION);
    expect(result).toEqual({ ok: true, value: FAKE_GITHUB_SESSION });
  });

  it("makes no network calls", async () => {
    const askForPAT = vi.fn() as unknown as AskForPATFn;
    const provider = new PATAuthProvider("github", makeTokenStore(), askForPAT);
    await provider.refresh(FAKE_GITHUB_SESSION);
    expect((askForPAT as Mock).mock.calls).toHaveLength(0);
  });

  it("wrong provider: returns { code: 'auth_failed' }", async () => {
    const provider = new PATAuthProvider(
      "github",
      makeTokenStore(),
      vi.fn() as unknown as AskForPATFn,
    );
    const result = await provider.refresh({
      provider: "github",
      accessToken: "gho_token",
      login: "ada",
      displayName: "Ada",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("auth_failed");
  });

  it("wrong platform: returns { code: 'auth_failed' }", async () => {
    const provider = new PATAuthProvider(
      "github",
      makeTokenStore(),
      vi.fn() as unknown as AskForPATFn,
    );
    const result = await provider.refresh(FAKE_ADO_SESSION);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("auth_failed");
  });
});

// ---------------------------------------------------------------------------
// Unit tests — signOut()
// ---------------------------------------------------------------------------

describe("PATAuthProvider.signOut()", () => {
  it("deletes the token store entry and returns success", async () => {
    const tokenStore = makeTokenStore();
    await tokenStore.save("pat-github", FAKE_GITHUB_SESSION);

    const provider = new PATAuthProvider("github", tokenStore, vi.fn() as unknown as AskForPATFn);
    const result = await provider.signOut(FAKE_GITHUB_SESSION);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(tokenStore.delete).toHaveBeenCalledWith("pat-github");
    expect(await tokenStore.load("pat-github")).toBeNull();
  });

  it("makes no network calls (local-only)", async () => {
    const askForPAT = vi.fn() as unknown as AskForPATFn;
    const provider = new PATAuthProvider("github", makeTokenStore(), askForPAT);
    await provider.signOut(FAKE_GITHUB_SESSION);
    expect((askForPAT as Mock).mock.calls).toHaveLength(0);
  });

  it("wrong provider: returns { code: 'auth_failed' }", async () => {
    const provider = new PATAuthProvider(
      "github",
      makeTokenStore(),
      vi.fn() as unknown as AskForPATFn,
    );
    const result = await provider.signOut({
      provider: "github",
      accessToken: "gho_token",
      login: "ada",
      displayName: "Ada",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("auth_failed");
  });

  it("wrong platform: returns { code: 'auth_failed' }", async () => {
    const provider = new PATAuthProvider(
      "github",
      makeTokenStore(),
      vi.fn() as unknown as AskForPATFn,
    );
    const result = await provider.signOut(FAKE_ADO_SESSION);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("auth_failed");
  });
});
