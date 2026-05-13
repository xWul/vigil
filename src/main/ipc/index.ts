import { dialog, shell } from "electron";
import type { BrowserWindow } from "electron";

import { err, ok } from "../../shared/result.js";
import type { ConnectedAccount } from "../../shared/auth.js";
import type { IpcEvents } from "../../shared/ipc-contract.js";
import type { PullRequest } from "../../shared/model/index.js";
import { createAzureDevOpsAuthProvider } from "../auth/AzureDevOpsAuthProvider.js";
import { createGitHubAuthProvider } from "../auth/GitHubAuthProvider.js";
import { createPATAuthProvider } from "../auth/PATAuthProvider.js";
import type { AuthSession, AzureDevOpsSession, GitHubSession } from "../auth/AuthProvider.js";
import type { TokenStore } from "../auth/TokenStore.js";
import { AnthropicProvider } from "../ai/AnthropicProvider.js";
import { OpenAIProvider } from "../ai/OpenAIProvider.js";
import { ComplexityAnalyzer } from "../ai/analyzers/ComplexityAnalyzer.js";
import { DebugArtifactsAnalyzer } from "../ai/analyzers/DebugArtifactsAnalyzer.js";
import { DuplicationAnalyzer } from "../ai/analyzers/DuplicationAnalyzer.js";
import { SmellsAnalyzer } from "../ai/analyzers/SmellsAnalyzer.js";
import { TypeSafetyAnalyzer } from "../ai/analyzers/TypeSafetyAnalyzer.js";
import { ChangeClassifierAnalyzer } from "../ai/analyzers/ChangeClassifierAnalyzer.js";
import { SilentRegressionAnalyzer } from "../ai/analyzers/SilentRegressionAnalyzer.js";
import { buildReviewContext } from "../ai/buildReviewContext.js";
import { runReview } from "../ai/runReview.js";
import { AzureDevOpsProvider } from "../platforms/AzureDevOpsProvider.js";
import { GitHubProvider } from "../platforms/GitHubProvider.js";
import type { Logger } from "../../shared/logger.js";
import type { SettingsStore } from "../settings/SettingsStore.js";
import { handle } from "./handlers.js";

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

function sessionToAccount(session: AuthSession): ConnectedAccount {
  if (session.provider === "github") {
    const s = session as GitHubSession;
    return { platform: "github", displayName: s.displayName, login: s.login };
  }
  if (session.provider === "azure-devops") {
    const s = session as AzureDevOpsSession;
    return { platform: "azure-devops", displayName: s.displayName, login: s.upn };
  }
  return { platform: session.platform, displayName: "PAT user", login: "pat" };
}

async function loadSession(
  tokenStore: TokenStore,
  platform: "github" | "azure-devops",
): Promise<AuthSession | null> {
  const primary = await tokenStore.load(platform);
  if (primary) return primary;
  return tokenStore.load(`pat-${platform}`);
}

// ---------------------------------------------------------------------------
// registerHandlers
// ---------------------------------------------------------------------------

export function registerHandlers(
  mainWindow: BrowserWindow,
  tokenStore: TokenStore,
  settingsStore: SettingsStore,
  logger: Logger,
): void {
  // ── Auth ────────────────────────────────────────────────────────────────

  handle("auth:signIn", async (platform) => {
    if (platform === "github") {
      const provider = createGitHubAuthProvider(
        tokenStore,
        async (userCode, verificationUri) => {
          await shell.openExternal(verificationUri);
          await dialog.showMessageBox(mainWindow, {
            type: "info",
            title: "Sign in to GitHub",
            message: `Enter this code at GitHub:\n\n${userCode}\n\nWe've opened your browser. After entering the code, click OK to continue.`,
            buttons: ["OK"],
          });
        },
        logger,
      );
      const result = await provider.signIn();
      if (!result.ok) return result;
      return ok(sessionToAccount(result.value));
    }

    const provider = createAzureDevOpsAuthProvider(
      tokenStore,
      (url) => shell.openExternal(url),
      logger,
    );
    const result = await provider.signIn();
    if (!result.ok) return result;
    return ok(sessionToAccount(result.value));
  });

  handle("auth:signInWithPAT", async (platform, token) => {
    const provider = createPATAuthProvider(platform, tokenStore, async () => token, logger);
    const result = await provider.signIn();
    if (!result.ok) return result;
    return ok(sessionToAccount(result.value));
  });

  handle("auth:signOut", async (platform) => {
    const session = await loadSession(tokenStore, platform);
    if (!session) return ok(undefined);

    if (platform === "github") {
      const provider = createGitHubAuthProvider(tokenStore, async () => {}, logger);
      return provider.signOut(session);
    }
    const provider = createAzureDevOpsAuthProvider(
      tokenStore,
      () => shell.openExternal(""),
      logger,
    );
    return provider.signOut(session);
  });

  handle("auth:getAccounts", async () => {
    const platforms: Array<"github" | "azure-devops"> = ["github", "azure-devops"];
    const accounts: ConnectedAccount[] = [];
    for (const platform of platforms) {
      const session = await loadSession(tokenStore, platform);
      if (session) accounts.push(sessionToAccount(session));
    }
    return ok(accounts);
  });

  // ── Platform ─────────────────────────────────────────────────────────────

  handle("platform:listPRs", async () => {
    const results: PullRequest[] = [];

    const githubSession = await loadSession(tokenStore, "github");
    if (githubSession) {
      const provider = new GitHubProvider(logger);
      const r = await provider.listOpenPullRequests(githubSession);
      if (r.ok) results.push(...r.value);
    }

    const adoSession = await loadSession(tokenStore, "azure-devops");
    if (adoSession && adoSession.provider === "azure-devops") {
      const provider = new AzureDevOpsProvider(
        (adoSession as AzureDevOpsSession).upn.split("@")[1] ?? "",
        logger,
      );
      const r = await provider.listOpenPullRequests(adoSession);
      if (r.ok) results.push(...r.value);
    }

    return ok(results);
  });

  handle("platform:getPRWithDiff", async (ref) => {
    const platform = ref.platform === "github" ? "github" : "azure-devops";
    const session = await loadSession(tokenStore, platform);
    if (!session) return err({ code: "forbidden" } as const);

    const provider =
      ref.platform === "github"
        ? new GitHubProvider(logger)
        : new AzureDevOpsProvider(ref.platform === "azure-devops" ? ref.org : "", logger);

    const [prResult, diffResult] = await Promise.all([
      provider.getPullRequest(session, ref),
      provider.getDiff(session, ref),
    ]);

    if (!prResult.ok) return prResult;
    if (!diffResult.ok) return diffResult;

    return ok({ pr: prResult.value, diff: diffResult.value });
  });

  handle("platform:submitReview", async (ref, review) => {
    const platform = ref.platform === "github" ? "github" : "azure-devops";
    const session = await loadSession(tokenStore, platform);
    if (!session) return err({ code: "forbidden" } as const);

    const provider =
      ref.platform === "github"
        ? new GitHubProvider(logger)
        : new AzureDevOpsProvider(ref.platform === "azure-devops" ? ref.org : "", logger);

    return provider.submitReview(session, ref, review);
  });

  handle("platform:postComment", async (ref, comment) => {
    const platform = ref.platform === "github" ? "github" : "azure-devops";
    const session = await loadSession(tokenStore, platform);
    if (!session) return err({ code: "forbidden" } as const);

    const provider =
      ref.platform === "github"
        ? new GitHubProvider(logger)
        : new AzureDevOpsProvider(ref.platform === "azure-devops" ? ref.org : "", logger);

    return provider.postComment(session, ref, comment);
  });

  // ── Review ────────────────────────────────────────────────────────────────

  handle("review:run", async (ref) => {
    const platform = ref.platform === "github" ? "github" : "azure-devops";
    const session = await loadSession(tokenStore, platform);
    if (!session) return err({ code: "network", cause: "No session for platform" } as const);

    const settings = await settingsStore.get();
    const provider =
      ref.platform === "github"
        ? new GitHubProvider(logger)
        : new AzureDevOpsProvider(ref.platform === "azure-devops" ? ref.org : "", logger);

    const contextResult = await buildReviewContext(session, provider, ref);
    if (!contextResult.ok) return contextResult;

    const context = contextResult.value;
    const reviewId = context.pr.headSha;

    const emit = <K extends keyof IpcEvents>(channel: K, payload: IpcEvents[K]) => {
      mainWindow.webContents.send(channel, payload);
    };

    emit("review:pass", { reviewId, pass: "complexity", status: "start", count: 0 });

    let aiProvider = null;
    if (settings.aiProvider === "anthropic") {
      const key = await settingsStore.getApiKey("anthropic");
      if (key) aiProvider = new AnthropicProvider(key, logger);
    } else if (settings.aiProvider === "openai") {
      const key = await settingsStore.getApiKey("openai");
      if (key) aiProvider = new OpenAIProvider(key, logger);
    }

    const model = settings.model ?? (settings.aiProvider === "anthropic" ? "claude-sonnet-4-6" : "gpt-4.1-mini");

    const analyzers = [
      new ComplexityAnalyzer(),
      new DuplicationAnalyzer(),
      new SmellsAnalyzer(),
      new DebugArtifactsAnalyzer(),
      new TypeSafetyAnalyzer(),
      new ChangeClassifierAnalyzer(),
      new SilentRegressionAnalyzer(),
    ];

    const result = await runReview(context, analyzers, aiProvider, { model }, logger);
    if (!result.ok) return result;

    for (const finding of result.value.findings) {
      emit("review:finding", { reviewId, finding });
    }

    return result;
  });

  handle("review:getCached", async (_ref, _headSha) => {
    // Cache lookup is file-based; implement when cache path is wired through app deps
    return ok(null);
  });

  // ── Settings ──────────────────────────────────────────────────────────────

  handle("settings:get", async () => {
    return ok(await settingsStore.get());
  });

  handle("settings:set", async (update) => {
    try {
      await settingsStore.set(update);
      return ok(undefined);
    } catch (e) {
      return err({ code: "write_failed", message: e instanceof Error ? e.message : String(e) } as const);
    }
  });

  handle("settings:setApiKey", async (provider, key) => {
    try {
      await settingsStore.setApiKey(provider, key);
      return ok(undefined);
    } catch (e) {
      return err({ code: "write_failed", message: e instanceof Error ? e.message : String(e) } as const);
    }
  });

  handle("settings:deleteApiKey", async (provider) => {
    try {
      await settingsStore.deleteApiKey(provider);
      return ok(undefined);
    } catch (e) {
      return err({ code: "write_failed", message: e instanceof Error ? e.message : String(e) } as const);
    }
  });
}
