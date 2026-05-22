/**
 * Phase 2 exit criterion: given a PR URL, fetch the normalized PullRequest
 * and Diff and print them as JSON.
 *
 * Usage:
 *   node --experimental-strip-types scripts/fetch-pr.ts <pr-url>
 *
 * Examples:
 *   node --experimental-strip-types scripts/fetch-pr.ts \
 *     https://github.com/acmecorp/backend/pull/42
 *   node --experimental-strip-types scripts/fetch-pr.ts \
 *     https://dev.azure.com/acmecorp/backend/_git/api/pullrequest/1337
 *
 * Set VIGIL_LOG_LEVEL=debug to see structured log output.
 *
 * Prerequisites:
 *   Run pnpm auth:github or pnpm auth:ado first to create a session file.
 */

import { join } from "node:path";

import { FileTokenStore } from "../src/main/auth/FileTokenStore.js";
import { AzureDevOpsProvider } from "../src/main/platforms/AzureDevOpsProvider.js";
import { GitHubProvider } from "../src/main/platforms/GitHubProvider.js";
import { parsePRUrl } from "../src/main/platforms/parsePRUrl.js";
import { ConsoleLogger } from "../src/shared/logger.js";

const logger = ConsoleLogger.fromEnv();

const rawUrl = process.argv[2];
if (!rawUrl) {
  console.error("Usage: node --experimental-strip-types scripts/fetch-pr.ts <pr-url>");
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

const provider =
  ref.platform === "github" ? new GitHubProvider(logger) : new AzureDevOpsProvider(ref.org, logger);

const prResult = await provider.getPullRequest(session, ref);
if (!prResult.ok) {
  console.error("Failed to fetch PR:", prResult.error);
  process.exit(1);
}

const diffResult = await provider.getDiff(session, ref);
if (!diffResult.ok) {
  console.error("Failed to fetch diff:", diffResult.error);
  process.exit(1);
}

console.log(JSON.stringify({ pr: prResult.value, diff: diffResult.value }, null, 2));
