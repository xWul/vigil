import { err, ok } from "../../shared/result.js";
import type { Result } from "../../shared/result.js";
import type { AuthSession } from "../auth/AuthProvider.js";
import type { FileDiff } from "../platforms/model/index.js";
import type { PlatformProvider, PRRef } from "../platforms/PlatformProvider.js";
import type { ReviewContext, ReviewError } from "./CodeAnalyzer.js";
import type { RepoCache } from "../git/RepoCache.js";

export const DEFAULT_TOKEN_BUDGET = 160_000;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function countChangedLines(file: FileDiff): number {
  return file.hunks.reduce((sum, h) => sum + h.lines.length, 0);
}

export async function buildReviewContext(
  session: AuthSession,
  provider: PlatformProvider,
  ref: PRRef,
  tokenBudget: number = DEFAULT_TOKEN_BUDGET,
  repoCache?: RepoCache,
): Promise<Result<ReviewContext, ReviewError>> {
  const prResult = await provider.getPullRequest(session, ref);
  if (!prResult.ok) {
    return err({ code: "network", cause: prResult.error.code });
  }
  const pr = prResult.value;

  const diffResult = await provider.getDiff(session, ref);
  if (!diffResult.ok) {
    return err({ code: "network", cause: diffResult.error.code });
  }
  const diff = diffResult.value;

  const metaTokens = estimateTokens(pr.title + pr.body);
  const diffText = diff.files
    .map((f) => f.newPath + f.hunks.flatMap((h) => h.lines.map((l) => l.content)).join("\n"))
    .join("");
  const diffTokens = estimateTokens(diffText);

  if (metaTokens + diffTokens > tokenBudget) {
    return err({ code: "context_too_large" });
  }

  const sortedFiles = diff.files
    .filter((f) => f.status !== "deleted")
    .slice()
    .sort((a, b) => countChangedLines(b) - countChangedLines(a));

  if (repoCache) {
    repoCache.ensureCloned(session, ref);
  }

  const files = new Map<string, string>();
  let usedTokens = metaTokens + diffTokens;

  for (const file of sortedFiles) {
    if (usedTokens >= tokenBudget) break;
    if (!pr.headSha) continue;

    let content: string | undefined;

    if (repoCache) {
      const cacheResult = await repoCache.readFile(ref, pr.headSha, file.newPath);
      if (cacheResult.ok) content = cacheResult.value;
    }

    if (content === undefined) {
      const apiResult = await provider.getFileContent(session, ref, file.newPath, pr.headSha);
      if (!apiResult.ok) continue;
      content = apiResult.value;
    }

    const fileTokens = estimateTokens(content);
    if (usedTokens + fileTokens <= tokenBudget) {
      files.set(file.newPath, content);
      usedTokens += fileTokens;
    }
  }

  return ok({ pr, diff, files, tokenBudget });
}
