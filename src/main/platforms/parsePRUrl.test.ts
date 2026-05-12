import { describe, expect, it } from "vitest";

import { parsePRUrl } from "./parsePRUrl.js";

describe("parsePRUrl", () => {
  describe("GitHub URLs", () => {
    it("parses a standard GitHub PR URL", () => {
      const result = parsePRUrl("https://github.com/acmecorp/backend/pull/42");
      expect(result).toEqual({
        ok: true,
        value: { platform: "github", owner: "acmecorp", repo: "backend", number: 42 },
      });
    });

    it("parses a GitHub PR URL with trailing slash", () => {
      const result = parsePRUrl("https://github.com/acmecorp/backend/pull/42/");
      expect(result).toEqual({
        ok: true,
        value: { platform: "github", owner: "acmecorp", repo: "backend", number: 42 },
      });
    });

    it("parses a GitHub PR URL with leading/trailing whitespace", () => {
      const result = parsePRUrl("  https://github.com/acmecorp/backend/pull/42  ");
      expect(result.ok).toBe(true);
    });

    it("rejects a GitHub repo URL (no pull number)", () => {
      expect(parsePRUrl("https://github.com/acmecorp/backend").ok).toBe(false);
    });

    it("rejects a GitHub PR URL with extra path segments", () => {
      expect(parsePRUrl("https://github.com/acmecorp/backend/pull/42/files").ok).toBe(false);
    });

    it("rejects a GitHub compare URL", () => {
      expect(parsePRUrl("https://github.com/acmecorp/backend/compare/main...feature").ok).toBe(
        false,
      );
    });
  });

  describe("Azure DevOps modern URLs", () => {
    it("parses a dev.azure.com PR URL", () => {
      const result = parsePRUrl("https://dev.azure.com/acmecorp/backend/_git/api/pullrequest/1337");
      expect(result).toEqual({
        ok: true,
        value: {
          platform: "azure-devops",
          org: "acmecorp",
          project: "backend",
          repo: "api",
          id: 1337,
        },
      });
    });

    it("parses a dev.azure.com URL with trailing slash", () => {
      const result = parsePRUrl(
        "https://dev.azure.com/acmecorp/backend/_git/api/pullrequest/1337/",
      );
      expect(result.ok).toBe(true);
    });

    it("rejects a dev.azure.com URL without pullrequest segment", () => {
      expect(parsePRUrl("https://dev.azure.com/acmecorp/backend/_git/api").ok).toBe(false);
    });
  });

  describe("Azure DevOps legacy URLs", () => {
    it("parses a visualstudio.com PR URL", () => {
      const result = parsePRUrl(
        "https://acmecorp.visualstudio.com/backend/_git/api/pullrequest/1337",
      );
      expect(result).toEqual({
        ok: true,
        value: {
          platform: "azure-devops",
          org: "acmecorp",
          project: "backend",
          repo: "api",
          id: 1337,
        },
      });
    });
  });

  describe("unrecognized URLs", () => {
    it("rejects a GitLab merge request URL", () => {
      const result = parsePRUrl("https://gitlab.com/owner/repo/-/merge_requests/1");
      expect(result.ok).toBe(false);
    });

    it("rejects a plain string", () => {
      expect(parsePRUrl("not-a-url").ok).toBe(false);
    });

    it("rejects an empty string", () => {
      expect(parsePRUrl("").ok).toBe(false);
    });

    it("includes the original URL in the error", () => {
      const raw = "https://gitlab.com/owner/repo/-/merge_requests/1";
      const result = parsePRUrl(raw);
      if (result.ok) throw new Error("expected error");
      expect(result.error.url).toBe(raw);
    });

    it("error code is unrecognized_url", () => {
      const result = parsePRUrl("https://example.com/some/path");
      if (result.ok) throw new Error("expected error");
      expect(result.error.code).toBe("unrecognized_url");
    });
  });
});
