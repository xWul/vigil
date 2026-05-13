/**
 * Phase 3 exit criterion: given a PR URL, run the full review pipeline
 * and print findings + summary.
 *
 * Usage:
 *   pnpm review <pr-url> [--post]
 *
 * Flags:
 *   --post  Post findings as an inline GitHub/ADO review on the PR.
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY  — use Anthropic (default model: claude-sonnet-4-6)
 *   OPENAI_API_KEY     — use OpenAI (default model: gpt-4.1-mini)
 *   VIGIL_MODEL        — override the model name
 *   VIGIL_LOG_LEVEL    — set log level (debug, info, warn, error)
 *   VIGIL_TOKEN_BUDGET — max tokens of context sent per AI pass (default: 160000).
 *                        Reduce for providers with lower TPM limits, e.g.
 *                        VIGIL_TOKEN_BUDGET=20000 for OpenAI free-tier accounts.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { FileTokenStore } from "../src/main/auth/FileTokenStore.js";
import { AnthropicProvider } from "../src/main/ai/AnthropicProvider.js";
import { OpenAIProvider } from "../src/main/ai/OpenAIProvider.js";
import { ComplexityAnalyzer } from "../src/main/ai/analyzers/ComplexityAnalyzer.js";
import { DebugArtifactsAnalyzer } from "../src/main/ai/analyzers/DebugArtifactsAnalyzer.js";
import { DuplicationAnalyzer } from "../src/main/ai/analyzers/DuplicationAnalyzer.js";
import { SmellsAnalyzer } from "../src/main/ai/analyzers/SmellsAnalyzer.js";
import { TypeSafetyAnalyzer } from "../src/main/ai/analyzers/TypeSafetyAnalyzer.js";
import { ChangeClassifierAnalyzer } from "../src/main/ai/analyzers/ChangeClassifierAnalyzer.js";
import { SilentRegressionAnalyzer } from "../src/main/ai/analyzers/SilentRegressionAnalyzer.js";
import { buildReviewContext, DEFAULT_TOKEN_BUDGET } from "../src/main/ai/buildReviewContext.js";
import { runReview } from "../src/main/ai/runReview.js";
import { AzureDevOpsProvider } from "../src/main/platforms/AzureDevOpsProvider.js";
import { GitHubProvider } from "../src/main/platforms/GitHubProvider.js";
import { parsePRUrl } from "../src/main/platforms/parsePRUrl.js";
import { ConsoleLogger } from "../src/shared/logger.js";
import type { AIProvider } from "../src/main/ai/AIProvider.js";
import type { Finding, ReviewResult } from "../src/main/ai/CodeAnalyzer.js";
import type { NewComment, NewReview, PRRef } from "../src/main/platforms/PlatformProvider.js";

// ---------------------------------------------------------------------------
// Review cache
// ---------------------------------------------------------------------------

const CACHE_DIR = join(import.meta.dirname, ".review-cache");

function cacheKey(ref: PRRef, headSha: string): string {
  if (ref.platform === "github") {
    return `github-${ref.owner}-${ref.repo}-${ref.number}-${headSha}`;
  }
  return `ado-${ref.org}-${ref.project}-${ref.repo}-${ref.id}-${headSha}`;
}

function loadFromCache(ref: PRRef, headSha: string): ReviewResult | null {
  try {
    const raw = readFileSync(join(CACHE_DIR, `${cacheKey(ref, headSha)}.json`), "utf-8");
    return JSON.parse(raw) as ReviewResult;
  } catch {
    return null;
  }
}

function saveToCache(ref: PRRef, headSha: string, result: ReviewResult): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(
    join(CACHE_DIR, `${cacheKey(ref, headSha)}.json`),
    JSON.stringify(result, null, 2),
    "utf-8",
  );
}

// ---------------------------------------------------------------------------
// PR posting
// ---------------------------------------------------------------------------

function formatFindingBody(f: Finding): string {
  const lines = [`**[${f.severity.toUpperCase()}] ${f.title}**`, "", f.description];
  if (f.evidence) lines.push("", "```", f.evidence, "```");
  return lines.join("\n");
}

function buildReview(result: ReviewResult): NewReview {
  const hasHighSeverity = result.findings.some(
    (f) => f.severity === "critical" || f.severity === "high",
  );

  const inlineFindings = result.findings.filter((f) => f.file && f.lines);
  const bodyFindings = result.findings.filter((f) => !f.file || !f.lines);

  const comments: NewComment[] = inlineFindings.map((f) => ({
    kind: "inline" as const,
    body: formatFindingBody(f),
    path: f.file,
    line: f.lines!.start,
  }));

  const bodyParts: string[] = ["## Vigil Review"];

  if (result.riskScore !== null) {
    bodyParts.push(`\n**Risk score:** ${result.riskScore} / 5`);
  }
  if (result.summary) {
    bodyParts.push(`\n${result.summary}`);
  }

  if (bodyFindings.length > 0) {
    bodyParts.push("\n### Other findings");
    for (const f of bodyFindings) {
      bodyParts.push(`- **[${f.severity.toUpperCase()}]** ${f.title} — ${f.description}`);
    }
  }

  if (result.findings.length === 0) {
    bodyParts.push("\nNo issues found. Looks good!");
  }

  return {
    verdict: hasHighSeverity ? "changes_requested" : "commented",
    body: bodyParts.join("\n"),
    comments,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const logger = ConsoleLogger.fromEnv();

const args = process.argv.slice(2);
const rawUrl = args.find((a) => !a.startsWith("--"));
const shouldPost = args.includes("--post");

if (!rawUrl) {
  console.error("Usage: pnpm review <pr-url> [--post]");
  process.exit(1);
}

const refResult = parsePRUrl(rawUrl);
if (!refResult.ok) {
  console.error(`Unrecognized PR URL: ${rawUrl}`);
  process.exit(1);
}
const ref = refResult.value;

const sessionKey = ref.platform === "github" ? "github" : "azure-devops";
const sessionFile = join(
  import.meta.dirname,
  ref.platform === "github" ? ".github-session.json" : ".ado-session.json",
);

const tokenStore = new FileTokenStore(sessionFile);
const session = await tokenStore.load(sessionKey);
if (!session) {
  const cmd = ref.platform === "github" ? "auth:github" : "auth:ado";
  console.error(`No session found. Run pnpm ${cmd} first.`);
  process.exit(1);
}

const platformProvider =
  ref.platform === "github" ? new GitHubProvider(logger) : new AzureDevOpsProvider(ref.org, logger);

let aiProvider: AIProvider | null = null;
const anthropicKey = process.env["ANTHROPIC_API_KEY"];
const openaiKey = process.env["OPENAI_API_KEY"];
const defaultModel = process.env["VIGIL_MODEL"];

if (anthropicKey) {
  aiProvider = new AnthropicProvider(anthropicKey, logger);
} else if (openaiKey) {
  aiProvider = new OpenAIProvider(openaiKey, logger);
}

const model = defaultModel ?? (anthropicKey ? "claude-sonnet-4-6" : "gpt-4.1-mini");

const rawBudget = process.env["VIGIL_TOKEN_BUDGET"];
const tokenBudget = rawBudget ? parseInt(rawBudget, 10) : undefined;
if (rawBudget && (isNaN(tokenBudget!) || tokenBudget! <= 0)) {
  console.error("VIGIL_TOKEN_BUDGET must be a positive integer");
  process.exit(1);
}

const effectiveBudget = tokenBudget ?? DEFAULT_TOKEN_BUDGET;
console.error(`Building review context… (token budget: ${effectiveBudget.toLocaleString()})`);
const contextResult = await buildReviewContext(session, platformProvider, ref, tokenBudget);
if (!contextResult.ok) {
  console.error("Failed to build context:", contextResult.error);
  process.exit(1);
}

const context = contextResult.value;
console.error(
  `Context ready: ${context.diff.files.length} files in diff, ${context.files.size} files loaded`,
);

// Check cache before running AI
const headSha = context.pr.headSha ?? "";
const cached = headSha ? loadFromCache(ref, headSha) : null;

let result: ReviewResult;
if (cached) {
  console.error("Cache hit — using stored review result.");
  result = cached;
} else {
  if (!aiProvider) {
    console.error("No AI provider configured. Running static analysis only.");
  }

  const analyzers = [
    new ComplexityAnalyzer(),
    new DuplicationAnalyzer(),
    new SmellsAnalyzer(),
    new DebugArtifactsAnalyzer(),
    new TypeSafetyAnalyzer(),
    new ChangeClassifierAnalyzer(),
    new SilentRegressionAnalyzer(),
  ];

  const reviewResult = await runReview(context, analyzers, aiProvider, { model }, logger);
  if (!reviewResult.ok) {
    const { error } = reviewResult;
    if (
      error.code === "network" &&
      /request too large|tokens per min/i.test(error.cause)
    ) {
      console.error(
        `Review failed: the request exceeded the provider's token limit.\n` +
        `  Requested: ~${effectiveBudget.toLocaleString()} tokens of context\n` +
        `  Fix: set a lower budget, e.g.:\n` +
        `    VIGIL_TOKEN_BUDGET=20000 pnpm review <pr-url>`,
      );
    } else if (error.code === "context_too_large") {
      console.error(
        `Review failed: the PR diff alone exceeds the token budget (${effectiveBudget.toLocaleString()}).\n` +
        `  This PR is too large to review in one pass.\n` +
        `  For AI review, upgrade to a plan with a higher TPM limit.`,
      );
    } else {
      console.error("Review failed:", error);
    }
    process.exit(1);
  }

  result = reviewResult.value;

  if (headSha) {
    saveToCache(ref, headSha, result);
    console.error(`Review cached (${cacheKey(ref, headSha)}).`);
  }
}

// ---------------------------------------------------------------------------
// Print results
// ---------------------------------------------------------------------------

if (result.findings.length === 0) {
  console.log("\nNo issues found.");
} else {
  console.log(`\n${result.findings.length} finding(s):\n`);
  for (const f of result.findings) {
    const loc = f.lines ? `:${f.lines.start}` : "";
    console.log(`[${f.severity.toUpperCase()}] ${f.title}`);
    console.log(`  ${f.file}${loc} (${f.pass}/${f.source})`);
    console.log(`  ${f.description}`);
    if (f.evidence) console.log(`  > ${f.evidence.split("\n")[0]}`);
    console.log();
  }
}

if (result.summary) {
  console.log("Summary:", result.summary);
  console.log("Risk score:", result.riskScore, "/ 5");
}

// ---------------------------------------------------------------------------
// Post to PR
// ---------------------------------------------------------------------------

if (shouldPost) {
  const review = buildReview(result);
  console.error(`\nPosting review (${review.comments.length} inline comment(s), verdict: ${review.verdict})…`);

  const postResult = await platformProvider.submitReview(session, ref, review);
  if (!postResult.ok) {
    console.error("Failed to post review:", postResult.error);
    process.exit(1);
  }

  console.error("Review posted.");
}
