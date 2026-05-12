import { err, ok } from "../../shared/result.js";
import type { Result } from "../../shared/result.js";
import { NoopLogger } from "../../shared/logger.js";
import type { Logger } from "../../shared/logger.js";
import type { AuthSession } from "../auth/AuthProvider.js";
import type {
  Comment,
  Diff,
  FileDiff,
  NewComment,
  NewReview,
  PlatformError,
  PRRef,
  PullRequest,
} from "./model/index.js";
import type { PlatformProvider } from "./PlatformProvider.js";

const ADO_API_VERSION = "7.1";
const VSSPS_BASE = "https://app.vssps.visualstudio.com";

// ---------------------------------------------------------------------------
// Internal ADO API shapes
// ---------------------------------------------------------------------------

interface AdoProfile {
  id: string;
  displayName: string;
}

interface AdoPullRequest {
  pullRequestId: number;
  title: string;
  description?: string;
  status: string;
  isDraft?: boolean;
  createdBy: { uniqueName: string; displayName: string };
  creationDate: string;
  _links?: { web?: { href: string } };
  targetRefName: string;
  sourceRefName: string;
  repository: { name: string; project: { name: string } };
  lastMergeSourceCommit?: { commitId: string };
  lastMergeTargetCommit?: { commitId: string };
}

interface AdoPullRequestsResponse {
  value: AdoPullRequest[];
}

interface AdoIteration {
  id: number;
}

interface AdoIterationsResponse {
  value: AdoIteration[];
}

interface AdoChangeEntry {
  changeType: number;
  item: { path: string };
  originalPath?: string;
}

interface AdoChangesResponse {
  changeEntries: AdoChangeEntry[];
}

interface AdoThread {
  id: number;
  comments: {
    id: number;
    content: string;
    author: { displayName: string; uniqueName: string };
    publishedDate: string;
  }[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADO_CHANGE = { Add: 2, Edit: 4, Rename: 16, Delete: 32 } as const;

function adoChangeTypeToStatus(changeType: number): FileDiff["status"] {
  if (changeType & ADO_CHANGE.Delete) return "deleted";
  if (changeType & ADO_CHANGE.Rename) return "renamed";
  if (changeType & ADO_CHANGE.Add) return "added";
  return "modified";
}

function stripRefPrefix(ref: string): string {
  return ref.replace(/^refs\/heads\//, "");
}

async function adoRequestText(
  url: string,
  accessToken: string,
): Promise<Result<string, PlatformError>> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "text/plain",
      },
    });
  } catch (e) {
    return err({ code: "network", cause: e instanceof Error ? e.message : String(e) });
  }

  if (!response.ok) {
    if (response.status === 404) return err({ code: "not_found" });
    if (response.status === 403) return err({ code: "forbidden" });
    return err({ code: "platform_error", message: `HTTP ${response.status}` });
  }

  return ok(await response.text());
}

async function adoRequest<T>(
  url: string,
  accessToken: string,
  init?: { method?: string; body?: string },
): Promise<Result<T, PlatformError>> {
  let response: Response;
  try {
    const fetchInit: RequestInit = {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    };
    if (init?.body !== undefined) fetchInit.body = init.body;
    response = await fetch(url, fetchInit);
  } catch (e) {
    return err({ code: "network", cause: e instanceof Error ? e.message : String(e) });
  }

  if (!response.ok) {
    if (response.status === 404) return err({ code: "not_found" });
    if (response.status === 403) return err({ code: "forbidden" });
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      const retryAfterMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : undefined;
      return err(
        retryAfterMs !== undefined
          ? { code: "rate_limited", retryAfterMs }
          : { code: "rate_limited" },
      );
    }
    return err({ code: "platform_error", message: `HTTP ${response.status}` });
  }

  return ok((await response.json()) as T);
}

function adoUrl(base: string, path: string): string {
  return `${base}${path}${path.includes("?") ? "&" : "?"}api-version=${ADO_API_VERSION}`;
}

function adoPrToModel(pr: AdoPullRequest, org: string): PullRequest {
  const project = pr.repository.project.name;
  const repo = pr.repository.name;
  const webUrl =
    pr._links?.web?.href ??
    `https://dev.azure.com/${org}/${project}/_git/${repo}/pullrequest/${pr.pullRequestId}`;

  return {
    ref: {
      platform: "azure-devops",
      org,
      project,
      repo,
      id: pr.pullRequestId,
    },
    title: pr.title,
    body: pr.description ?? "",
    author: {
      displayName: pr.createdBy.displayName,
      login: pr.createdBy.uniqueName,
    },
    state: pr.isDraft === true ? "draft" : "open",
    createdAt: new Date(pr.creationDate),
    updatedAt: new Date(pr.creationDate),
    url: webUrl,
    targetBranch: stripRefPrefix(pr.targetRefName),
    sourceBranch: stripRefPrefix(pr.sourceRefName),
    headSha: pr.lastMergeSourceCommit?.commitId ?? "",
  };
}

// ---------------------------------------------------------------------------
// discoverOrgs
// ---------------------------------------------------------------------------

export async function discoverOrgs(session: AuthSession): Promise<Result<string[], PlatformError>> {
  const profileResult = await adoRequest<AdoProfile>(
    adoUrl(`${VSSPS_BASE}/_apis/profile/profiles/me`, ""),
    session.accessToken,
  );
  if (!profileResult.ok) return profileResult;

  const userId = profileResult.value.id;
  const accountsResult = await adoRequest<{ value: { accountName: string }[] }>(
    adoUrl(`${VSSPS_BASE}/_apis/accounts`, `?memberId=${userId}`),
    session.accessToken,
  );
  if (!accountsResult.ok) return accountsResult;

  return ok(accountsResult.value.value.map((a) => a.accountName));
}

// ---------------------------------------------------------------------------
// AzureDevOpsProvider
// ---------------------------------------------------------------------------

export class AzureDevOpsProvider implements PlatformProvider {
  readonly id = "azure-devops" as const;

  constructor(
    private readonly org: string,
    private readonly logger: Logger = new NoopLogger(),
  ) {}

  private get base(): string {
    return `https://dev.azure.com/${this.org}`;
  }

  async listOpenPullRequests(
    session: AuthSession,
  ): Promise<Result<readonly PullRequest[], PlatformError>> {
    this.logger.info("ado.listOpenPullRequests.start", { org: this.org });

    const profileResult = await adoRequest<AdoProfile>(
      adoUrl(`${VSSPS_BASE}/_apis/profile/profiles/me`, ""),
      session.accessToken,
    );
    if (!profileResult.ok) return profileResult;

    const userId = profileResult.value.id;
    const url = adoUrl(
      `${this.base}/_apis/git/pullrequests`,
      `?reviewerID=${userId}&status=active`,
    );
    const result = await adoRequest<AdoPullRequestsResponse>(url, session.accessToken);
    if (!result.ok) return result;

    const prs = result.value.value.map((pr) => adoPrToModel(pr, this.org));
    this.logger.info("ado.listOpenPullRequests.complete", { count: prs.length });
    return ok(prs);
  }

  async getPullRequest(
    session: AuthSession,
    ref: PRRef,
  ): Promise<Result<PullRequest, PlatformError>> {
    if (ref.platform !== "azure-devops") {
      return err({ code: "platform_error", message: "ref platform mismatch" });
    }
    this.logger.debug("ado.getPullRequest.start", { id: ref.id });

    const url = adoUrl(
      `${this.base}/${ref.project}/_apis/git/repositories/${ref.repo}/pullrequests/${ref.id}`,
      "",
    );
    const result = await adoRequest<AdoPullRequest>(url, session.accessToken);
    if (!result.ok) return result;

    const pr = adoPrToModel(result.value, this.org);
    this.logger.debug("ado.getPullRequest.complete", { title: result.value.title });
    return ok(pr);
  }

  async getDiff(session: AuthSession, ref: PRRef): Promise<Result<Diff, PlatformError>> {
    if (ref.platform !== "azure-devops") {
      return err({ code: "platform_error", message: "ref platform mismatch" });
    }
    this.logger.debug("ado.getDiff.start", { id: ref.id });

    const iterationsUrl = adoUrl(
      `${this.base}/${ref.project}/_apis/git/repositories/${ref.repo}/pullrequests/${ref.id}/iterations`,
      "",
    );
    const iterationsResult = await adoRequest<AdoIterationsResponse>(
      iterationsUrl,
      session.accessToken,
    );
    if (!iterationsResult.ok) return iterationsResult;

    const iterations = iterationsResult.value.value;
    const latestId = iterations[iterations.length - 1]?.id;
    if (latestId === undefined) {
      return ok({ files: [] });
    }

    const changesUrl = adoUrl(
      `${this.base}/${ref.project}/_apis/git/repositories/${ref.repo}/pullrequests/${ref.id}/iterations/${latestId}/changes`,
      "",
    );
    const changesResult = await adoRequest<AdoChangesResponse>(changesUrl, session.accessToken);
    if (!changesResult.ok) return changesResult;

    // Full diff content (hunks/lines) requires fetching file contents at both commits.
    // This is deferred to Phase 3 when the AI pipeline needs line-level data.
    const files: FileDiff[] = changesResult.value.changeEntries.map((entry) => ({
      status: adoChangeTypeToStatus(entry.changeType),
      oldPath: entry.originalPath ?? null,
      newPath: entry.item.path,
      hunks: [],
    }));

    this.logger.debug("ado.getDiff.complete", { fileCount: files.length });
    return ok({ files });
  }

  async postComment(
    session: AuthSession,
    ref: PRRef,
    comment: NewComment,
  ): Promise<Result<Comment, PlatformError>> {
    if (ref.platform !== "azure-devops") {
      return err({ code: "platform_error", message: "ref platform mismatch" });
    }

    const threadBody =
      comment.kind === "inline"
        ? {
            comments: [{ parentCommentId: 0, content: comment.body, commentType: 1 }],
            threadContext: {
              filePath: comment.path,
              rightFileEnd: { line: comment.line, offset: 1 },
              rightFileStart: { line: comment.line, offset: 1 },
            },
            status: 1,
          }
        : {
            comments: [{ parentCommentId: 0, content: comment.body, commentType: 1 }],
            status: 1,
          };

    const url = adoUrl(
      `${this.base}/${ref.project}/_apis/git/repositories/${ref.repo}/pullrequests/${ref.id}/threads`,
      "",
    );
    const result = await adoRequest<AdoThread>(url, session.accessToken, {
      method: "POST",
      body: JSON.stringify(threadBody),
    });
    if (!result.ok) return result;

    const firstComment = result.value.comments[0];
    if (!firstComment) {
      return err({ code: "platform_error", message: "empty thread response" });
    }
    return ok({
      id: String(firstComment.id),
      body: firstComment.content,
      author: {
        displayName: firstComment.author.displayName,
        login: firstComment.author.uniqueName,
      },
      createdAt: new Date(firstComment.publishedDate),
    });
  }

  async submitReview(
    session: AuthSession,
    ref: PRRef,
    review: NewReview,
  ): Promise<Result<void, PlatformError>> {
    if (ref.platform !== "azure-devops") {
      return err({ code: "platform_error", message: "ref platform mismatch" });
    }

    const profileResult = await adoRequest<AdoProfile>(
      adoUrl(`${VSSPS_BASE}/_apis/profile/profiles/me`, ""),
      session.accessToken,
    );
    if (!profileResult.ok) return profileResult;

    const voteMap: Record<string, number> = {
      approved: 10,
      changes_requested: -10,
      commented: 0,
    };
    const vote = voteMap[review.verdict] ?? 0;

    const url = adoUrl(
      `${this.base}/${ref.project}/_apis/git/repositories/${ref.repo}/pullrequests/${ref.id}/reviewers/${profileResult.value.id}`,
      "",
    );
    const result = await adoRequest<unknown>(url, session.accessToken, {
      method: "PUT",
      body: JSON.stringify({ vote }),
    });
    if (!result.ok) return result;

    return ok(undefined);
  }

  async getFileContent(
    session: AuthSession,
    ref: PRRef,
    path: string,
    commitSha: string,
  ): Promise<Result<string, PlatformError>> {
    if (ref.platform !== "azure-devops") {
      return err({ code: "platform_error", message: "ref platform mismatch" });
    }

    const encodedPath = encodeURIComponent(path);
    const url = adoUrl(
      `${this.base}/${ref.project}/_apis/git/repositories/${ref.repo}/items`,
      `?path=${encodedPath}&versionDescriptor.version=${commitSha}&versionDescriptor.versionType=commit`,
    );
    return adoRequestText(url, session.accessToken);
  }
}

export function createAzureDevOpsProvider(org: string, logger?: Logger): AzureDevOpsProvider {
  return new AzureDevOpsProvider(org, logger);
}
