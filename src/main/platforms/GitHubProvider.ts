import { Octokit } from "@octokit/rest";

import { err, ok } from "../../shared/result.js";
import type { Result } from "../../shared/result.js";
import { NoopLogger } from "../../shared/logger.js";
import type { Logger } from "../../shared/logger.js";
import type { AuthSession } from "../auth/AuthProvider.js";
import { parseUnifiedDiff } from "./parseUnifiedDiff.js";
import type {
  Comment,
  Diff,
  FileDiff,
  NewComment,
  NewReview,
  PlatformError,
  PRRef,
  PullRequest,
  ReviewVerdict,
} from "./model/index.js";
import type { PlatformProvider } from "./PlatformProvider.js";

function isHttpError(
  e: unknown,
): e is { status: number; response?: { headers: Record<string, string | undefined> } } {
  return (
    typeof e === "object" &&
    e !== null &&
    "status" in e &&
    typeof (e as Record<string, unknown>)["status"] === "number"
  );
}

function toPlatformError(e: unknown): PlatformError {
  if (isHttpError(e)) {
    if (e.status === 404) return { code: "not_found" };
    if (e.status === 403) {
      const remaining = e.response?.headers["x-ratelimit-remaining"];
      if (remaining === "0") {
        const reset = e.response?.headers["x-ratelimit-reset"];
        const retryAfterMs = reset
          ? Math.max(0, parseInt(reset, 10) * 1000 - Date.now())
          : undefined;
        return retryAfterMs !== undefined
          ? { code: "rate_limited", retryAfterMs }
          : { code: "rate_limited" };
      }
      return { code: "forbidden" };
    }
    return { code: "platform_error", message: `HTTP ${e.status}` };
  }
  const cause = e instanceof Error ? e.message : String(e);
  if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET/i.test(cause)) {
    return { code: "network", cause };
  }
  return { code: "platform_error", message: cause };
}

function toFileDiffStatus(status: string): FileDiff["status"] {
  switch (status) {
    case "added":
      return "added";
    case "removed":
      return "deleted";
    case "renamed":
      return "renamed";
    default:
      return "modified";
  }
}

const REVIEW_EVENT: Record<ReviewVerdict, "APPROVE" | "REQUEST_CHANGES" | "COMMENT"> = {
  approved: "APPROVE",
  changes_requested: "REQUEST_CHANGES",
  commented: "COMMENT",
};

export class GitHubProvider implements PlatformProvider {
  readonly id = "github" as const;

  constructor(private readonly logger: Logger = new NoopLogger()) {}

  async listOpenPullRequests(
    session: AuthSession,
  ): Promise<Result<readonly PullRequest[], PlatformError>> {
    const octokit = new Octokit({ auth: session.accessToken });
    this.logger.info("github.listOpenPullRequests.start");

    try {
      const { data } = await octokit.rest.search.issuesAndPullRequests({
        q: "is:open is:pr involves:@me",
        per_page: 100,
      });

      const prs: PullRequest[] = [];
      for (const item of data.items) {
        const m = /\/repos\/([^/]+)\/([^/]+)$/.exec(item.repository_url);
        if (!m) continue;
        // listOpenPullRequests uses the search API which does not return branch names.
        // Callers that need branches should call getPullRequest with the ref.
        prs.push({
          ref: { platform: "github", owner: m[1]!, repo: m[2]!, number: item.number },
          title: item.title,
          body: item.body ?? "",
          author: {
            displayName: item.user?.login ?? "unknown",
            login: item.user?.login ?? "unknown",
          },
          state: item.draft === true ? "draft" : "open",
          createdAt: new Date(item.created_at),
          updatedAt: new Date(item.updated_at),
          url: item.html_url,
          targetBranch: "",
          sourceBranch: "",
          headSha: "",
        });
      }

      this.logger.info("github.listOpenPullRequests.complete", { count: prs.length });
      return ok(prs);
    } catch (e) {
      const error = toPlatformError(e);
      this.logger.error("github.listOpenPullRequests.failed", { code: error.code });
      return err(error);
    }
  }

  async getPullRequest(
    session: AuthSession,
    ref: PRRef,
  ): Promise<Result<PullRequest, PlatformError>> {
    if (ref.platform !== "github") {
      return err({ code: "platform_error", message: "ref platform mismatch" });
    }
    const octokit = new Octokit({ auth: session.accessToken });
    this.logger.debug("github.getPullRequest.start", {
      owner: ref.owner,
      repo: ref.repo,
      number: ref.number,
    });

    try {
      const { data } = await octokit.rest.pulls.get({
        owner: ref.owner,
        repo: ref.repo,
        pull_number: ref.number,
      });

      const pr: PullRequest = {
        ref,
        title: data.title,
        body: data.body ?? "",
        author: {
          displayName: data.user?.login ?? "unknown",
          login: data.user?.login ?? "unknown",
        },
        state: data.draft === true ? "draft" : "open",
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.updated_at),
        url: data.html_url,
        targetBranch: data.base.ref,
        sourceBranch: data.head.ref,
        headSha: data.head.sha,
      };

      this.logger.debug("github.getPullRequest.complete", { title: data.title });
      return ok(pr);
    } catch (e) {
      const error = toPlatformError(e);
      this.logger.error("github.getPullRequest.failed", { code: error.code });
      return err(error);
    }
  }

  async getDiff(session: AuthSession, ref: PRRef): Promise<Result<Diff, PlatformError>> {
    if (ref.platform !== "github") {
      return err({ code: "platform_error", message: "ref platform mismatch" });
    }
    const octokit = new Octokit({ auth: session.accessToken });
    this.logger.debug("github.getDiff.start", {
      owner: ref.owner,
      repo: ref.repo,
      number: ref.number,
    });

    try {
      const { data } = await octokit.rest.pulls.listFiles({
        owner: ref.owner,
        repo: ref.repo,
        pull_number: ref.number,
        per_page: 100,
      });

      const files: FileDiff[] = data.map((file) => ({
        status: toFileDiffStatus(file.status),
        oldPath: file.status === "renamed" ? (file.previous_filename ?? null) : null,
        newPath: file.filename,
        hunks: file.patch ? parseUnifiedDiff(file.patch) : [],
      }));

      this.logger.debug("github.getDiff.complete", { fileCount: files.length });
      return ok({ files });
    } catch (e) {
      const error = toPlatformError(e);
      this.logger.error("github.getDiff.failed", { code: error.code });
      return err(error);
    }
  }

  async postComment(
    session: AuthSession,
    ref: PRRef,
    comment: NewComment,
  ): Promise<Result<Comment, PlatformError>> {
    if (ref.platform !== "github") {
      return err({ code: "platform_error", message: "ref platform mismatch" });
    }
    const octokit = new Octokit({ auth: session.accessToken });

    try {
      if (comment.kind === "pr_comment") {
        const { data } = await octokit.rest.issues.createComment({
          owner: ref.owner,
          repo: ref.repo,
          issue_number: ref.number,
          body: comment.body,
        });
        return ok({
          id: String(data.id),
          body: data.body ?? "",
          author: {
            displayName: data.user?.login ?? "unknown",
            login: data.user?.login ?? "unknown",
          },
          createdAt: new Date(data.created_at),
        });
      }

      // Inline comment requires the head commit SHA.
      const { data: pr } = await octokit.rest.pulls.get({
        owner: ref.owner,
        repo: ref.repo,
        pull_number: ref.number,
      });

      const { data } = await octokit.rest.pulls.createReviewComment({
        owner: ref.owner,
        repo: ref.repo,
        pull_number: ref.number,
        commit_id: pr.head.sha,
        body: comment.body,
        path: comment.path,
        line: comment.line,
        side: "RIGHT",
      });
      return ok({
        id: String(data.id),
        body: data.body,
        author: {
          displayName: data.user?.login ?? "unknown",
          login: data.user?.login ?? "unknown",
        },
        createdAt: new Date(data.created_at),
      });
    } catch (e) {
      return err(toPlatformError(e));
    }
  }

  async submitReview(
    session: AuthSession,
    ref: PRRef,
    review: NewReview,
  ): Promise<Result<void, PlatformError>> {
    if (ref.platform !== "github") {
      return err({ code: "platform_error", message: "ref platform mismatch" });
    }
    const octokit = new Octokit({ auth: session.accessToken });

    try {
      await octokit.rest.pulls.createReview({
        owner: ref.owner,
        repo: ref.repo,
        pull_number: ref.number,
        event: REVIEW_EVENT[review.verdict],
        body: review.body,
        comments: review.comments
          .filter((c): c is NewComment & { kind: "inline" } => c.kind === "inline")
          .map((c) => ({
            path: c.path,
            line: c.line,
            side: "RIGHT" as const,
            body: c.body,
          })),
      });
      return ok(undefined);
    } catch (e) {
      return err(toPlatformError(e));
    }
  }

  async getFileContent(
    session: AuthSession,
    ref: PRRef,
    path: string,
    commitSha: string,
  ): Promise<Result<string, PlatformError>> {
    if (ref.platform !== "github") {
      return err({ code: "platform_error", message: "ref platform mismatch" });
    }
    const octokit = new Octokit({ auth: session.accessToken });

    try {
      const { data } = await octokit.rest.repos.getContent({
        owner: ref.owner,
        repo: ref.repo,
        path,
        ref: commitSha,
      });

      if (Array.isArray(data) || data.type !== "file") {
        return err({ code: "not_found" });
      }

      const content = Buffer.from(data.content, "base64").toString("utf-8");
      return ok(content);
    } catch (e) {
      return err(toPlatformError(e));
    }
  }
}

export function createGitHubProvider(logger?: Logger): GitHubProvider {
  return new GitHubProvider(logger);
}
