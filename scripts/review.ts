/**
 * Phase 3 exit criterion: given a PR URL, run the full review pipeline
 * and print findings + summary.
 *
 * Usage:
 *   pnpm review <pr-url>
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY  — use Anthropic (default model: claude-sonnet-4-6)
 *   OPENAI_API_KEY     — use OpenAI (default model: gpt-4o)
 *   VIGIL_MODEL        — override the model name
 *   VIGIL_LOG_LEVEL    — set log level (debug, info, warn, error)
 */

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
import { buildReviewContext } from "../src/main/ai/buildReviewContext.js";
import { runReview } from "../src/main/ai/runReview.js";
import { AzureDevOpsProvider } from "../src/main/platforms/AzureDevOpsProvider.js";
import { GitHubProvider } from "../src/main/platforms/GitHubProvider.js";
import { parsePRUrl } from "../src/main/platforms/parsePRUrl.js";
import { ConsoleLogger } from "../src/shared/logger.js";
import type { AIProvider } from "../src/main/ai/AIProvider.js";

const logger = ConsoleLogger.fromEnv();

const rawUrl = process.argv[2];
if (!rawUrl) {
  console.error("Usage: pnpm review <pr-url>");
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

const model = defaultModel ?? (anthropicKey ? "claude-sonnet-4-6" : "gpt-4o");

console.error("Building review context…");
const contextResult = await buildReviewContext(session, platformProvider, ref);
if (!contextResult.ok) {
  console.error("Failed to build context:", contextResult.error);
  process.exit(1);
}

const context = contextResult.value;
console.error(
  `Context ready: ${context.diff.files.length} files in diff, ${context.files.size} files loaded`,
);

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
  console.error("Review failed:", reviewResult.error);
  process.exit(1);
}

const result = reviewResult.value;

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
