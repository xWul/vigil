import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import type { AzureDevOpsSession } from "../auth/AuthProvider.js";
import { AzureDevOpsProvider, discoverOrgs } from "./AzureDevOpsProvider.js";
import { describePlatformProviderContract } from "./platformProviderContract.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_SESSION: AzureDevOpsSession = {
  provider: "azure-devops",
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresAt: Date.now() + 3_600_000,
  displayName: "Ada Lovelace",
  upn: "ada@acmecorp.com",
};

const VALID_REF = {
  platform: "azure-devops" as const,
  org: "acmecorp",
  project: "backend",
  repo: "api",
  id: 1337,
};

const ADO_PROFILE = { id: "user-guid-123", displayName: "Ada Lovelace" };

const ADO_PR = {
  pullRequestId: 1337,
  title: "Fix authentication bug",
  description: "Closes #41",
  status: "active",
  isDraft: false,
  createdBy: { uniqueName: "ada@acmecorp.com", displayName: "Ada Lovelace" },
  creationDate: "2026-01-01T00:00:00Z",
  _links: { web: { href: "https://dev.azure.com/acmecorp/backend/_git/api/pullrequest/1337" } },
  targetRefName: "refs/heads/main",
  sourceRefName: "refs/heads/fix/auth",
  lastMergeSourceCommit: { commitId: "abc123" },
  lastMergeTargetCommit: { commitId: "def456" },
  repository: { name: "api", project: { name: "backend" } },
};

const ADO_PRS_RESPONSE = { value: [ADO_PR], count: 1 };

const ADO_ITERATIONS = { value: [{ id: 1 }, { id: 2 }] };

const ADO_CHANGES = {
  changeEntries: [
    { changeType: 4, item: { path: "/src/auth.ts" }, originalPath: undefined },
    { changeType: 2, item: { path: "/src/new-file.ts" }, originalPath: undefined },
  ],
};

const AUTH_TS_BASE = "export function old(): void {}";
const AUTH_TS_HEAD = "export function new_(): void {}";

const ADO_THREAD = {
  id: 10,
  comments: [
    {
      id: 1,
      content: "LGTM",
      author: { displayName: "Ada Lovelace", uniqueName: "ada@acmecorp.com" },
      publishedDate: "2026-01-01T00:00:00Z",
    },
  ],
};

// ---------------------------------------------------------------------------
// MSW server
// ---------------------------------------------------------------------------

const server = setupServer(
  http.get("https://app.vssps.visualstudio.com/_apis/profile/profiles/me", () => {
    return HttpResponse.json(ADO_PROFILE);
  }),
  http.get("https://dev.azure.com/acmecorp/_apis/git/pullrequests", () => {
    return HttpResponse.json(ADO_PRS_RESPONSE);
  }),
  http.get(
    "https://dev.azure.com/acmecorp/backend/_apis/git/repositories/api/pullrequests/1337",
    () => {
      return HttpResponse.json(ADO_PR);
    },
  ),
  http.get(
    "https://dev.azure.com/acmecorp/backend/_apis/git/repositories/api/pullrequests/1337/iterations",
    () => {
      return HttpResponse.json(ADO_ITERATIONS);
    },
  ),
  http.get(
    "https://dev.azure.com/acmecorp/backend/_apis/git/repositories/api/pullrequests/1337/iterations/2/changes",
    () => {
      return HttpResponse.json(ADO_CHANGES);
    },
  ),
  http.post(
    "https://dev.azure.com/acmecorp/backend/_apis/git/repositories/api/pullrequests/1337/threads",
    () => {
      return HttpResponse.json(ADO_THREAD);
    },
  ),
  http.put(
    "https://dev.azure.com/acmecorp/backend/_apis/git/repositories/api/pullrequests/1337/reviewers/user-guid-123",
    () => {
      return HttpResponse.json({ vote: 0 });
    },
  ),
  // File content requests for getDiff hunk generation
  http.get(
    "https://dev.azure.com/acmecorp/backend/_apis/git/repositories/api/items",
    ({ request }) => {
      const url = new URL(request.url);
      const path = url.searchParams.get("path");
      const version = url.searchParams.get("versionDescriptor.version");
      if (path === "/src/auth.ts" && version === "def456") return HttpResponse.text(AUTH_TS_BASE);
      if (path === "/src/auth.ts" && version === "abc123") return HttpResponse.text(AUTH_TS_HEAD);
      if (path === "/src/new-file.ts" && version === "abc123")
        return HttpResponse.text("export const x = 1;");
      return new HttpResponse(null, { status: 404 });
    },
  ),
  // 404 for missing PR used in contract test
  http.get(
    "https://dev.azure.com/acmecorp/missing/_apis/git/repositories/repo/pullrequests/99999",
    () => {
      return new HttpResponse(null, { status: 404 });
    },
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// ---------------------------------------------------------------------------
// Contract tests
// ---------------------------------------------------------------------------

describePlatformProviderContract("AzureDevOpsProvider (contract)", () => ({
  provider: new AzureDevOpsProvider("acmecorp"),
  session: FAKE_SESSION,
  validRef: VALID_REF,
}));

// ---------------------------------------------------------------------------
// Provider-specific tests
// ---------------------------------------------------------------------------

describe("AzureDevOpsProvider", () => {
  describe("listOpenPullRequests", () => {
    it("maps ADO response to PullRequest[]", async () => {
      const provider = new AzureDevOpsProvider("acmecorp");
      const result = await provider.listOpenPullRequests(FAKE_SESSION);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(1);
      const pr = result.value[0]!;
      expect(pr.title).toBe("Fix authentication bug");
      expect(pr.targetBranch).toBe("main");
      expect(pr.sourceBranch).toBe("fix/auth");
      expect(pr.ref).toEqual(VALID_REF);
    });

    it("returns forbidden on 403", async () => {
      server.use(
        http.get("https://dev.azure.com/acmecorp/_apis/git/pullrequests", () => {
          return new HttpResponse(null, { status: 403 });
        }),
      );
      const result = await new AzureDevOpsProvider("acmecorp").listOpenPullRequests(FAKE_SESSION);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    });

    it("returns rate_limited on 429", async () => {
      server.use(
        http.get("https://dev.azure.com/acmecorp/_apis/git/pullrequests", () => {
          return new HttpResponse(null, {
            status: 429,
            headers: { "Retry-After": "60" },
          });
        }),
      );
      const result = await new AzureDevOpsProvider("acmecorp").listOpenPullRequests(FAKE_SESSION);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("rate_limited");
      if (result.error.code !== "rate_limited") return;
      expect(result.error.retryAfterMs).toBe(60_000);
    });
  });

  describe("getPullRequest", () => {
    it("maps ADO PR to PullRequest with branches", async () => {
      const result = await new AzureDevOpsProvider("acmecorp").getPullRequest(
        FAKE_SESSION,
        VALID_REF,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.targetBranch).toBe("main");
      expect(result.value.sourceBranch).toBe("fix/auth");
    });

    it("returns not_found on 404", async () => {
      server.use(
        http.get(
          "https://dev.azure.com/acmecorp/backend/_apis/git/repositories/api/pullrequests/1337",
          () => new HttpResponse(null, { status: 404 }),
        ),
      );
      const result = await new AzureDevOpsProvider("acmecorp").getPullRequest(
        FAKE_SESSION,
        VALID_REF,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("not_found");
    });
  });

  describe("getDiff", () => {
    it("returns file list with statuses from iteration changes", async () => {
      const result = await new AzureDevOpsProvider("acmecorp").getDiff(FAKE_SESSION, VALID_REF);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.files).toHaveLength(2);
      expect(result.value.files[0]!.status).toBe("modified");
      expect(result.value.files[0]!.newPath).toBe("/src/auth.ts");
      expect(result.value.files[1]!.status).toBe("added");
    });

    it("populates hunks with line-level diff for modified files", async () => {
      const result = await new AzureDevOpsProvider("acmecorp").getDiff(FAKE_SESSION, VALID_REF);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const authFile = result.value.files[0]!;
      expect(authFile.hunks.length).toBeGreaterThan(0);
      const lines = authFile.hunks[0]!.lines;
      expect(lines.some((l) => l.kind === "removed")).toBe(true);
      expect(lines.some((l) => l.kind === "added")).toBe(true);
    });

    it("populates hunks for added files using empty old content", async () => {
      const result = await new AzureDevOpsProvider("acmecorp").getDiff(FAKE_SESSION, VALID_REF);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const newFile = result.value.files[1]!;
      expect(newFile.hunks.length).toBeGreaterThan(0);
      const allAdded = newFile.hunks[0]!.lines.every((l) => l.kind === "added");
      expect(allAdded).toBe(true);
    });
  });

  describe("postComment", () => {
    it("posts a PR-level comment and returns Comment", async () => {
      const result = await new AzureDevOpsProvider("acmecorp").postComment(
        FAKE_SESSION,
        VALID_REF,
        { kind: "pr_comment", body: "LGTM" },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.body).toBe("LGTM");
    });
  });

  describe("submitReview", () => {
    it("returns ok(undefined) on success", async () => {
      const result = await new AzureDevOpsProvider("acmecorp").submitReview(
        FAKE_SESSION,
        VALID_REF,
        { verdict: "commented", body: "LGTM", comments: [] },
      );
      expect(result).toEqual({ ok: true, value: undefined });
    });
  });
});

describe("discoverOrgs", () => {
  it("returns the list of org names", async () => {
    server.use(
      http.get("https://app.vssps.visualstudio.com/_apis/accounts", () => {
        return HttpResponse.json({
          value: [{ accountName: "acmecorp" }, { accountName: "personal" }],
        });
      }),
    );
    const result = await discoverOrgs(FAKE_SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(["acmecorp", "personal"]);
  });
});
