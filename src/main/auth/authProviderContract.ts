import { describe, expect, it } from "vitest";

import type { AuthProvider, AuthSession } from "./AuthProvider.js";

/**
 * Shared contract tests for all AuthProvider implementations.
 * Pass a factory that returns a fully-configured, mock-backed provider
 * and a valid session for that provider.
 *
 * Usage:
 *   import { describeAuthProviderContract } from "./authProviderContract.js";
 *   describeAuthProviderContract("AzureDevOpsAuthProvider", () => ({ provider, session }));
 */
export interface AuthProviderTestFixture {
  provider: AuthProvider;
  /** A valid AuthSession that this provider will accept for refresh/signOut. */
  session: AuthSession;
}

export function describeAuthProviderContract(
  label: string,
  makeFixture: () => AuthProviderTestFixture,
): void {
  describe(label, () => {
    it("exposes a valid provider id", () => {
      const { provider } = makeFixture();
      expect(["azure-devops", "github", "pat"]).toContain(provider.id);
    });

    it("signIn() returns a Result-shaped value", async () => {
      const { provider } = makeFixture();
      const result = await provider.signIn();
      expect(typeof result.ok).toBe("boolean");
    });

    it("signOut() succeeds and returns void", async () => {
      const { provider, session } = makeFixture();
      const result = await provider.signOut(session);
      expect(result).toEqual({ ok: true, value: undefined });
    });

    it("successful signIn() session provider matches provider id", async () => {
      const { provider } = makeFixture();
      const result = await provider.signIn();
      if (result.ok) {
        expect(result.value.provider).toBe(provider.id);
      }
    });
  });
}
