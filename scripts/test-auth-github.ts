/**
 * Phase 1 exit criterion: manually test the GitHub Device Flow auth.
 *
 * On the first run: presents a user code and verification URL, polls until
 * the user completes sign-in, prints the session, and persists it to a
 * local file.
 *
 * On subsequent runs: restores the session from the file without any
 * browser interaction, and prints "restored from keychain".
 *
 * Prerequisites:
 *   - Set GITHUB_CLIENT_ID in GitHubAuthProvider.ts to the registered OAuth App client ID.
 *   - Run: node --experimental-strip-types scripts/test-auth-github.ts
 */

import { join } from "node:path";

import { FileTokenStore } from "../src/main/auth/FileTokenStore.js";
import { createGitHubAuthProvider } from "../src/main/auth/GitHubAuthProvider.js";
import { ConsoleLogger } from "../src/shared/logger.js";

const SESSION_FILE = join(import.meta.dirname, ".github-session.json");

function presentDeviceCode(userCode: string, verificationUri: string): Promise<void> {
  console.log("\nOpen the following URL in your browser and enter the code:");
  console.log(`  URL:  ${verificationUri}`);
  console.log(`  Code: ${userCode}`);
  console.log("\nWaiting for authorization...");
  return Promise.resolve();
}

async function main(): Promise<void> {
  const tokenStore = new FileTokenStore(SESSION_FILE);
  const existing = await tokenStore.load("github");

  if (existing?.provider === "github") {
    console.log("Restored from keychain:");
    console.log("  login:", existing.login);
    console.log("  displayName:", existing.displayName);
    return;
  }

  console.log("No existing session found — starting Device Flow sign-in...");

  const provider = createGitHubAuthProvider(tokenStore, presentDeviceCode, ConsoleLogger.fromEnv());
  const result = await provider.signIn();

  if (!result.ok) {
    console.error("Sign-in failed:", result.error);
    process.exit(1);
  }

  if (result.value.provider !== "github") {
    console.error("Unexpected provider:", result.value.provider);
    process.exit(1);
  }

  console.log("\nSign-in successful:");
  console.log("  login:", result.value.login);
  console.log("  displayName:", result.value.displayName);
  console.log(`Session saved to ${SESSION_FILE}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
