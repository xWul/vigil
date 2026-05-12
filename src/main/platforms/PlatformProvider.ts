import type { Result } from "../../shared/result.js";
import type { AuthSession } from "../auth/AuthProvider.js";
import type {
  Comment,
  Diff,
  NewComment,
  NewReview,
  PlatformError,
  PRRef,
  PullRequest,
} from "./model/index.js";

export type { Comment, Diff, NewComment, NewReview, PlatformError, PRRef, PullRequest };

export interface PlatformProvider {
  readonly id: "github" | "azure-devops";

  listOpenPullRequests(
    session: AuthSession,
  ): Promise<Result<readonly PullRequest[], PlatformError>>;

  getPullRequest(session: AuthSession, ref: PRRef): Promise<Result<PullRequest, PlatformError>>;

  getDiff(session: AuthSession, ref: PRRef): Promise<Result<Diff, PlatformError>>;

  postComment(
    session: AuthSession,
    ref: PRRef,
    comment: NewComment,
  ): Promise<Result<Comment, PlatformError>>;

  submitReview(
    session: AuthSession,
    ref: PRRef,
    review: NewReview,
  ): Promise<Result<void, PlatformError>>;
}
