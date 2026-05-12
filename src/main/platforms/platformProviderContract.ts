import { describe, expect, it } from "vitest";

import type { AuthSession } from "../auth/AuthProvider.js";
import type { PRRef, PullRequest } from "./model/index.js";
import type { PlatformProvider } from "./PlatformProvider.js";

export interface PlatformProviderFixture {
  provider: PlatformProvider;
  session: AuthSession;
  validRef: PRRef;
}

function assertPullRequestShape(pr: PullRequest): void {
  expect(typeof pr.title).toBe("string");
  expect(typeof pr.body).toBe("string");
  expect(typeof pr.url).toBe("string");
  expect(pr.url.length).toBeGreaterThan(0);
  expect(["open", "draft"]).toContain(pr.state);
  expect(pr.createdAt).toBeInstanceOf(Date);
  expect(pr.updatedAt).toBeInstanceOf(Date);
  expect(typeof pr.author.login).toBe("string");
  expect(typeof pr.author.displayName).toBe("string");
}

export function describePlatformProviderContract(
  label: string,
  makeFixture: () => PlatformProviderFixture,
): void {
  describe(label, () => {
    it("exposes a valid provider id", () => {
      const { provider } = makeFixture();
      expect(["github", "azure-devops"]).toContain(provider.id);
    });

    it("listOpenPullRequests returns well-formed PullRequests", async () => {
      const { provider, session } = makeFixture();
      const result = await provider.listOpenPullRequests(session);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBeGreaterThan(0);
      assertPullRequestShape(result.value[0]!);
    });

    it("getPullRequest returns a well-formed PullRequest", async () => {
      const { provider, session, validRef } = makeFixture();
      const result = await provider.getPullRequest(session, validRef);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      assertPullRequestShape(result.value);
      expect(result.value.ref.platform).toBe(validRef.platform);
    });

    it("getDiff returns a Diff with a files array", async () => {
      const { provider, session, validRef } = makeFixture();
      const result = await provider.getDiff(session, validRef);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(Array.isArray(result.value.files)).toBe(true);
    });

    it("getPullRequest returns not_found for a missing PR", async () => {
      const { provider, session, validRef } = makeFixture();
      const missingRef: PRRef =
        validRef.platform === "github"
          ? { platform: "github", owner: "missing", repo: "repo", number: 99999 }
          : {
              platform: "azure-devops",
              org: (validRef as { org: string }).org,
              project: "missing",
              repo: "repo",
              id: 99999,
            };
      const result = await provider.getPullRequest(session, missingRef);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("not_found");
    });

    it("submitReview returns ok(undefined) on success", async () => {
      const { provider, session, validRef } = makeFixture();
      const result = await provider.submitReview(session, validRef, {
        verdict: "commented",
        body: "LGTM",
        comments: [],
      });
      expect(result).toEqual({ ok: true, value: undefined });
    });
  });
}
