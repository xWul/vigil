import { randomBytes } from "node:crypto";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AzureDevOpsSession } from "./AuthProvider.js";
import { FileTokenStore } from "./FileTokenStore.js";
import type { TokenStore } from "./TokenStore.js";

// ---------------------------------------------------------------------------
// Contract tests — run against any TokenStore implementation
// ---------------------------------------------------------------------------

function describeTokenStoreContract(
  label: string,
  makeStore: () => TokenStore,
) {
  const session: AzureDevOpsSession = {
    provider: "azure-devops",
    accessToken: "at-test",
    refreshToken: "rt-test",
    expiresAt: Date.now() + 3600_000,
    displayName: "Ada Lovelace",
    upn: "ada@example.com",
  };

  describe(label, () => {
    it("saves and loads a session by key", async () => {
      const store = makeStore();
      await store.save("azure-devops", session);
      const loaded = await store.load("azure-devops");
      expect(loaded).toEqual(session);
    });

    it("returns null for an unknown key", async () => {
      const store = makeStore();
      expect(await store.load("does-not-exist")).toBeNull();
    });

    it("overwrites an existing session on save", async () => {
      const store = makeStore();
      await store.save("azure-devops", session);
      const updated = { ...session, displayName: "Updated Name" };
      await store.save("azure-devops", updated);
      expect(await store.load("azure-devops")).toEqual(updated);
    });

    it("delete removes the session", async () => {
      const store = makeStore();
      await store.save("azure-devops", session);
      await store.delete("azure-devops");
      expect(await store.load("azure-devops")).toBeNull();
    });

    it("delete is idempotent for a missing key", async () => {
      const store = makeStore();
      await expect(store.delete("does-not-exist")).resolves.toBeUndefined();
    });

    it("keys are independent", async () => {
      const store = makeStore();
      const session2 = { ...session, provider: "github" as const, accessToken: "gh-token", login: "ada" };
      await store.save("azure-devops", session);
      await store.save("github", session2);
      await store.delete("azure-devops");
      expect(await store.load("azure-devops")).toBeNull();
      expect(await store.load("github")).toEqual(session2);
    });
  });
}

// ---------------------------------------------------------------------------
// Run contract tests against FileTokenStore
// ---------------------------------------------------------------------------

function makeTempPath(): string {
  return join(tmpdir(), `vigil-test-${randomBytes(8).toString("hex")}.json`);
}

const filePaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    filePaths.splice(0).map((p) => unlink(p).catch(() => undefined)),
  );
});

describeTokenStoreContract("FileTokenStore", () => {
  const path = makeTempPath();
  filePaths.push(path);
  return new FileTokenStore(path);
});
