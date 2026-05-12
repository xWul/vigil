/**
 * Phase 1 exit criterion: manually test the Azure DevOps auth flow.
 *
 * On the first run: opens the browser, completes sign-in, prints the
 * session and persists it to a local file.
 *
 * On subsequent runs: restores the session from the file without opening
 * a browser, and prints "restored from keychain".
 *
 * Prerequisites:
 *   - Set AZURE_CLIENT_ID in AzureDevOpsAuthProvider.ts to the registered app ID.
 *   - Run: node --experimental-strip-types scripts/test-auth-ado.ts
 */

import { exec } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import { createAzureDevOpsAuthProvider } from "../src/main/auth/AzureDevOpsAuthProvider.js";
import { FileTokenStore } from "../src/main/auth/FileTokenStore.js";
import { ConsoleLogger } from "../src/shared/logger.js";

const execAsync = promisify(exec);
const SESSION_FILE = join(import.meta.dirname, ".ado-session.json");

async function openBrowser(url: string): Promise<void> {
  const cmd =
    process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  await execAsync(cmd);
}

async function main(): Promise<void> {
  const tokenStore = new FileTokenStore(SESSION_FILE);
  const existing = await tokenStore.load("azure-devops");

  if (existing?.provider === "azure-devops") {
    console.log("Restored from keychain:");
    console.log("  displayName:", existing.displayName);
    console.log("  upn:", existing.upn);
    console.log("  expiresAt:", new Date(existing.expiresAt).toISOString());
    return;
  }

  console.log("No existing session found — starting sign-in flow...");

  const provider = createAzureDevOpsAuthProvider(tokenStore, openBrowser, ConsoleLogger.fromEnv());
  const result = await provider.signIn();

  if (!result.ok) {
    console.error("Sign-in failed:", result.error);
    process.exit(1);
  }

  if (result.value.provider !== "azure-devops") {
    console.error("Unexpected provider:", result.value.provider);
    process.exit(1);
  }

  console.log("Sign-in successful:");
  console.log("  displayName:", result.value.displayName);
  console.log("  upn:", result.value.upn);
  console.log("  expiresAt:", new Date(result.value.expiresAt).toISOString());
  console.log(`Session saved to ${SESSION_FILE}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
