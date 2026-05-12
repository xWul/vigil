import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import type { GitHubSession } from "../auth/AuthProvider.js";
import { GitHubProvider } from "./GitHubProvider.js";
import { describePlatformProviderContract } from "./platformProviderContract.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_SESSION: GitHubSession = {
  provider: "github",
  accessToken: "gho_test_token",
  login: "ada",
  displayName: "Ada Lovelace",
};

const VALID_REF = { platform: "github" as const, owner: "acmecorp", repo: "backend", number: 42 };

const GITHUB_PR = {
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
  head: { ref: "fix/auth", sha: "abc123def456" },
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

const GITHUB_FILES = [
  {
    sha: "sha1",
    filename: "src/auth.ts",
    status: "modified",
    additions: 5,
    deletions: 2,
    changes: 7,
    blob_url: "https://github.com/acmecorp/backend/blob/abc123/src/auth.ts",
    raw_url: "https://github.com/acmecorp/backend/raw/abc123/src/auth.ts",
    contents_url: "https://api.github.com/repos/acmecorp/backend/contents/src/auth.ts",
    patch: "@@ -10,7 +10,10 @@\n context\n-old line\n+new line\n+extra line\n context",
  },
];

const GITHUB_SEARCH_RESPONSE = {
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

// ---------------------------------------------------------------------------
// MSW server
// ---------------------------------------------------------------------------

const server = setupServer(
  http.get("https://api.github.com/search/issues", () => {
    return HttpResponse.json(GITHUB_SEARCH_RESPONSE);
  }),
  http.get("https://api.github.com/repos/acmecorp/backend/pulls/42", () => {
    return HttpResponse.json(GITHUB_PR);
  }),
  http.get("https://api.github.com/repos/acmecorp/backend/pulls/42/files", () => {
    return HttpResponse.json(GITHUB_FILES);
  }),
  http.get("https://api.github.com/repos/acmecorp/backend/issues/42/comments", () => {
    return HttpResponse.json([]);
  }),
  http.post("https://api.github.com/repos/acmecorp/backend/issues/42/comments", () => {
    return HttpResponse.json({
      id: 1,
      body: "LGTM",
      created_at: "2026-01-01T00:00:00Z",
      user: { login: "ada", id: 1, node_id: "MDQ6VXNlcjE=", type: "User", site_admin: false },
    });
  }),
  http.post("https://api.github.com/repos/acmecorp/backend/pulls/42/reviews", () => {
    return HttpResponse.json({ id: 1, state: "COMMENTED" });
  }),
  // 404 for missing PR used in contract test
  http.get("https://api.github.com/repos/missing/repo/pulls/99999", () => {
    return new HttpResponse(null, { status: 404 });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// ---------------------------------------------------------------------------
// Contract tests
// ---------------------------------------------------------------------------

describePlatformProviderContract("GitHubProvider (contract)", () => ({
  provider: new GitHubProvider(),
  session: FAKE_SESSION,
  validRef: VALID_REF,
}));

// ---------------------------------------------------------------------------
// Provider-specific tests
// ---------------------------------------------------------------------------

describe("GitHubProvider", () => {
  describe("listOpenPullRequests", () => {
    it("maps search items to PullRequest[]", async () => {
      const provider = new GitHubProvider();
      const result = await provider.listOpenPullRequests(FAKE_SESSION);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      const pr = result.value[0]!;
      expect(pr.title).toBe("Fix authentication bug");
      expect(pr.author.login).toBe("ada");
      expect(pr.ref).toEqual(VALID_REF);
    });

    it("returns forbidden on 403 without rate limit header", async () => {
      server.use(
        http.get("https://api.github.com/search/issues", () => {
          return new HttpResponse(null, { status: 403 });
        }),
      );
      const result = await new GitHubProvider().listOpenPullRequests(FAKE_SESSION);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    });

    it("returns rate_limited on 403 with x-ratelimit-remaining: 0", async () => {
      server.use(
        http.get("https://api.github.com/search/issues", () => {
          return new HttpResponse(null, {
            status: 403,
            headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "9999999999" },
          });
        }),
      );
      const result = await new GitHubProvider().listOpenPullRequests(FAKE_SESSION);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("rate_limited");
    });
  });

  describe("getPullRequest", () => {
    it("maps the API response to PullRequest with branches", async () => {
      const result = await new GitHubProvider().getPullRequest(FAKE_SESSION, VALID_REF);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.targetBranch).toBe("main");
      expect(result.value.sourceBranch).toBe("fix/auth");
    });

    it("returns not_found on 404", async () => {
      server.use(
        http.get("https://api.github.com/repos/acmecorp/backend/pulls/42", () => {
          return new HttpResponse(null, { status: 404 });
        }),
      );
      const result = await new GitHubProvider().getPullRequest(FAKE_SESSION, VALID_REF);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("not_found");
    });

    it("returns platform_error for wrong ref platform", async () => {
      const adoRef = {
        platform: "azure-devops" as const,
        org: "o",
        project: "p",
        repo: "r",
        id: 1,
      };
      const result = await new GitHubProvider().getPullRequest(FAKE_SESSION, adoRef);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("platform_error");
    });
  });

  describe("getDiff", () => {
    it("parses file patches into FileDiff[]", async () => {
      const result = await new GitHubProvider().getDiff(FAKE_SESSION, VALID_REF);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.files).toHaveLength(1);
      const file = result.value.files[0]!;
      expect(file.newPath).toBe("src/auth.ts");
      expect(file.status).toBe("modified");
      expect(file.hunks.length).toBeGreaterThan(0);
    });

    it("sets oldPath to null for non-renamed files", async () => {
      const result = await new GitHubProvider().getDiff(FAKE_SESSION, VALID_REF);
      if (!result.ok) return;
      expect(result.value.files[0]!.oldPath).toBeNull();
    });

    it("sets oldPath for renamed files", async () => {
      server.use(
        http.get("https://api.github.com/repos/acmecorp/backend/pulls/42/files", () => {
          return HttpResponse.json([
            {
              sha: "sha2",
              filename: "src/renamed.ts",
              previous_filename: "src/old-name.ts",
              status: "renamed",
              additions: 0,
              deletions: 0,
              changes: 0,
              patch: "",
            },
          ]);
        }),
      );
      const result = await new GitHubProvider().getDiff(FAKE_SESSION, VALID_REF);
      if (!result.ok) return;
      const file = result.value.files[0]!;
      expect(file.status).toBe("renamed");
      expect(file.oldPath).toBe("src/old-name.ts");
    });
  });

  describe("postComment", () => {
    it("posts a PR-level comment and returns Comment", async () => {
      const result = await new GitHubProvider().postComment(FAKE_SESSION, VALID_REF, {
        kind: "pr_comment",
        body: "LGTM",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.body).toBe("LGTM");
    });
  });

  describe("submitReview", () => {
    it("returns ok(undefined) on success", async () => {
      const result = await new GitHubProvider().submitReview(FAKE_SESSION, VALID_REF, {
        verdict: "commented",
        body: "Looks good",
        comments: [],
      });
      expect(result).toEqual({ ok: true, value: undefined });
    });
  });
});
