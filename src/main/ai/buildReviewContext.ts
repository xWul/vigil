import { err, ok } from "../../shared/result.js";
import type { Result } from "../../shared/result.js";
import type { AuthSession } from "../auth/AuthProvider.js";
import type { FileDiff } from "../platforms/model/index.js";
import type { PlatformProvider, PRRef } from "../platforms/PlatformProvider.js";
import type { ReviewContext, ReviewError } from "./CodeAnalyzer.js";
import type { RepoCache } from "../git/RepoCache.js";
import { extractExportedSymbols } from "./extractSymbols.js";
import { getHeuristics, resolvePythonImport } from "./heuristics.js";
import { detectLanguage } from "./language.js";

export const DEFAULT_TOKEN_BUDGET = 160_000;
// Cross-file import context is capped at 20 % of the total budget so it
// cannot crowd out the diff or the changed files themselves.
const CROSS_FILE_BUDGET_FRACTION = 0.2;

const RELATIVE_IMPORT_RE = /from\s+['"](\.[^'"]+)['"]/g;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function countChangedLines(file: FileDiff): number {
  return file.hunks.reduce((sum, h) => sum + h.lines.length, 0);
}

/**
 * Resolve a relative import specifier from a source file to a repo-relative
 * path. TypeScript projects emit `.js` extensions in import specifiers that
 * point to `.ts` source files — this handles that convention.
 */
export function resolveRelativeImport(fromFile: string, importSpec: string): string {
  const dir = fromFile.includes("/") ? fromFile.split("/").slice(0, -1) : [];
  const parts = [...dir, ...importSpec.split("/")];
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "..") resolved.pop();
    else if (part !== ".") resolved.push(part);
  }
  const joined = resolved.join("/");
  if (joined.endsWith(".js")) return `${joined.slice(0, -3)}.ts`;
  if (joined.endsWith(".jsx")) return `${joined.slice(0, -4)}.tsx`;
  return joined;
}

/**
 * Return repo-relative paths for every relative import found across the
 * given files, excluding paths already present in the map.
 *
 * TypeScript/JavaScript: resolves `.js`-suffixed specifiers to `.ts` sources.
 * Python: resolves `from .foo import bar` style relative imports.
 * Other languages use absolute imports and are skipped.
 */
export function collectImportCandidates(files: ReadonlyMap<string, string>): string[] {
  const seen = new Set<string>(files.keys());
  const candidates: string[] = [];
  for (const [filePath, content] of files) {
    const lang = detectLanguage(filePath);
    if (lang === "typescript") {
      RELATIVE_IMPORT_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = RELATIVE_IMPORT_RE.exec(content)) !== null) {
        const resolved = resolveRelativeImport(filePath, match[1]!);
        if (!seen.has(resolved)) {
          seen.add(resolved);
          candidates.push(resolved);
        }
      }
    } else if (lang === "python") {
      const h = getHeuristics("python")!;
      const re = new RegExp(h.relativeImport!.source, "g");
      let match: RegExpExecArray | null;
      while ((match = re.exec(content)) !== null) {
        const resolved = resolvePythonImport(filePath, match[1]!, match[2] ?? "");
        if (resolved && !seen.has(resolved)) {
          seen.add(resolved);
          candidates.push(resolved);
        }
      }
    }
    // Other languages use absolute imports — cannot resolve to file paths
  }
  return candidates;
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

  // Enrich context with cross-file imports from the local cache.
  // Relative imports found in the changed files are fetched so the
  // consistency pass can compare new code against established patterns.
  if (repoCache && pr.headSha) {
    const crossFileCap = Math.floor(tokenBudget * CROSS_FILE_BUDGET_FRACTION);
    let crossFileTokens = 0;
    for (const importPath of collectImportCandidates(files)) {
      if (crossFileTokens >= crossFileCap || usedTokens >= tokenBudget) break;
      const result = await repoCache.readFile(ref, pr.headSha, importPath);
      if (!result.ok) continue;
      const symbolSummary = extractExportedSymbols(result.value, importPath);
      const t = estimateTokens(symbolSummary);
      if (crossFileTokens + t <= crossFileCap && usedTokens + t <= tokenBudget) {
        files.set(importPath, symbolSummary);
        usedTokens += t;
        crossFileTokens += t;
      }
    }
  }

  return ok({ pr, diff, files, tokenBudget });
}
