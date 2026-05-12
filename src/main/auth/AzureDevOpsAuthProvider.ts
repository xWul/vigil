import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { PublicClientApplication } from "@azure/msal-node";
import type { AuthenticationResult, Configuration } from "@azure/msal-node";

import { err, ok } from "../../shared/result.js";
import type { Result } from "../../shared/result.js";
import { NoopLogger } from "../../shared/logger.js";
import type { Logger } from "../../shared/logger.js";
import type { AuthError, AuthProvider, AuthSession, AzureDevOpsSession } from "./AuthProvider.js";
import { generatePkce } from "./pkce.js";
import type { TokenStore } from "./TokenStore.js";

// Public client ID — not a secret, safe to ship in source. See ADR-0003.
// TODO: replace with the registered Azure AD app client ID before shipping.
export const AZURE_CLIENT_ID = "33c7c9d4-d7c9-4caa-b1f2-c961e4bbed79";

const AUTHORITY = "https://login.microsoftonline.com/common";
const ADO_RESOURCE = "https://app.vssps.visualstudio.com";
const SCOPES = [
  `${ADO_RESOURCE}/vso.profile`,
  `${ADO_RESOURCE}/vso.project`,
  `${ADO_RESOURCE}/vso.code`,
  `${ADO_RESOURCE}/vso.code_write`,
  `${ADO_RESOURCE}/vso.code_status`,
  "offline_access",
];
const KEYCHAIN_KEY = "azure-devops";
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

type CallbackResult =
  | { readonly ok: true; readonly code: string }
  | { readonly ok: false; readonly error: string; readonly description: string };

// Exposed for testing (allows injecting a mock listener in unit tests)
export type CallbackListenerFn = (timeoutMs: number) => Promise<{
  redirectUri: string;
  result: Promise<CallbackResult>;
}>;

export function openCallbackListener(timeoutMs: number): Promise<{
  redirectUri: string;
  result: Promise<CallbackResult>;
}> {
  const { promise: callbackPromise, resolve: resolveCallback } =
    Promise.withResolvers<CallbackResult>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  return new Promise((resolveOuter, rejectOuter) => {
    const server = createServer((req, res) => {
      clearTimeout(timer);
      const url = new URL(req.url ?? "/", "http://localhost");
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      const description = url.searchParams.get("error_description") ?? "";

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<html><body><p>Sign-in complete. You may close this tab.</p></body></html>");
      server.close();

      resolveCallback(
        code ? { ok: true, code } : { ok: false, error: error ?? "unknown", description },
      );
    });

    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;

      timer = setTimeout(() => {
        server.close();
        resolveCallback({ ok: false, error: "timeout", description: "" });
      }, timeoutMs);

      resolveOuter({
        redirectUri: `http://localhost:${port}`,
        result: callbackPromise,
      });
    });

    server.on("error", (e) => {
      clearTimeout(timer);
      rejectOuter(e);
    });
  });
}

function makeMsalClient(): PublicClientApplication {
  const config: Configuration = {
    auth: { clientId: AZURE_CLIENT_ID, authority: AUTHORITY },
  };
  return new PublicClientApplication(config);
}

// MSAL does not expose refresh tokens in AuthenticationResult — they live only
// in the token cache. We serialize the cache after each exchange to extract
// the token for our own persistence layer (TokenStore / keychain).
function extractRefreshToken(msal: PublicClientApplication): string {
  const raw = JSON.parse(msal.getTokenCache().serialize()) as {
    RefreshToken: Record<string, { secret: string }>;
  };
  const entry = Object.values(raw.RefreshToken)[0];
  if (!entry) throw new Error("no refresh token in MSAL cache after token exchange");
  return entry.secret;
}

function msalResultToSession(
  result: AuthenticationResult,
  refreshToken: string,
): AzureDevOpsSession {
  return {
    provider: "azure-devops",
    accessToken: result.accessToken,
    refreshToken,
    expiresAt: result.expiresOn?.getTime() ?? Date.now() + 3_600_000,
    displayName: result.account?.name ?? "",
    upn: result.account?.username ?? "",
  };
}

function isMsalError(e: unknown): e is { errorCode: string; message: string } {
  if (typeof e !== "object" || e === null) return false;
  if (!("errorCode" in e)) return false;
  return typeof (e as { errorCode: unknown }).errorCode === "string";
}

const NETWORK_ERROR_PATTERN = /ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET/;

export class AzureDevOpsAuthProvider implements AuthProvider {
  readonly id = "azure-devops" as const;

  constructor(
    private readonly tokenStore: TokenStore,
    private readonly openBrowser: (url: string) => Promise<void>,
    private readonly createMsalClient: () => PublicClientApplication = makeMsalClient,
    private readonly listenForCallback: CallbackListenerFn = openCallbackListener,
    private readonly logger: Logger = new NoopLogger(),
  ) {}

  async signIn(): Promise<Result<AuthSession, AuthError>> {
    this.logger.info("ado.signIn.start");

    const pkce = generatePkce();
    let listener: Awaited<ReturnType<CallbackListenerFn>>;

    try {
      listener = await this.listenForCallback(SIGN_IN_TIMEOUT_MS);
    } catch (e) {
      this.logger.error("ado.signIn.failed", { code: "auth_failed" });
      return err({
        code: "auth_failed",
        message: e instanceof Error ? e.message : String(e),
      });
    }

    const port = Number(new URL(listener.redirectUri).port);
    this.logger.debug("ado.signIn.listenerReady", { port });

    const msal = this.createMsalClient();
    let authUrl: string;
    try {
      authUrl = await msal.getAuthCodeUrl({
        scopes: SCOPES,
        redirectUri: listener.redirectUri,
        codeChallenge: pkce.challenge,
        codeChallengeMethod: "S256",
      });
    } catch (e) {
      this.logger.error("ado.signIn.failed", { code: "network" });
      return err({
        code: "network",
        cause: e instanceof Error ? e.message : String(e),
      });
    }

    await this.openBrowser(authUrl);
    this.logger.info("ado.signIn.browserOpened");

    const callbackResult = await listener.result;
    this.logger.debug("ado.signIn.callbackReceived");

    if (!callbackResult.ok) {
      if (callbackResult.error === "timeout") {
        this.logger.error("ado.signIn.failed", { code: "timeout" });
        return err({ code: "timeout" });
      }
      if (callbackResult.error === "access_denied") {
        this.logger.error("ado.signIn.failed", { code: "consent_denied" });
        return err({ code: "consent_denied" });
      }
      this.logger.error("ado.signIn.failed", { code: "auth_failed" });
      return err({
        code: "auth_failed",
        message: callbackResult.description || callbackResult.error,
      });
    }

    let msalResult: AuthenticationResult | null;
    try {
      msalResult = await msal.acquireTokenByCode({
        code: callbackResult.code,
        scopes: SCOPES,
        redirectUri: listener.redirectUri,
        codeVerifier: pkce.verifier,
      });
    } catch (e) {
      if (isMsalError(e) && NETWORK_ERROR_PATTERN.test(e.message)) {
        this.logger.error("ado.signIn.failed", { code: "network" });
        return err({ code: "network", cause: e.message });
      }
      this.logger.error("ado.signIn.failed", { code: "auth_failed" });
      return err({
        code: "auth_failed",
        message: isMsalError(e) ? e.message : String(e),
      });
    }

    if (!msalResult) {
      this.logger.error("ado.signIn.failed", { code: "auth_failed" });
      return err({ code: "auth_failed", message: "no response from token endpoint" });
    }

    let refreshToken: string;
    try {
      refreshToken = extractRefreshToken(msal);
    } catch (e) {
      this.logger.error("ado.signIn.failed", { code: "auth_failed" });
      return err({
        code: "auth_failed",
        message: e instanceof Error ? e.message : String(e),
      });
    }

    const session = msalResultToSession(msalResult, refreshToken);
    await this.tokenStore.save(KEYCHAIN_KEY, session);
    this.logger.info("ado.signIn.complete", { upn: session.upn, displayName: session.displayName });
    return ok(session);
  }

  async refresh(session: AuthSession): Promise<Result<AuthSession, AuthError>> {
    if (session.provider !== "azure-devops") {
      return err({ code: "auth_failed", message: "session provider mismatch" });
    }

    this.logger.debug("ado.refresh.start");

    const msal = this.createMsalClient();
    let msalResult: AuthenticationResult | null;
    try {
      msalResult = await msal.acquireTokenByRefreshToken({
        refreshToken: session.refreshToken,
        scopes: SCOPES,
      });
    } catch (e) {
      if (isMsalError(e)) {
        if (e.errorCode === "invalid_grant") {
          this.logger.warn("ado.refresh.failed", { code: "refresh_expired" });
          return err({ code: "refresh_expired" });
        }
        if (NETWORK_ERROR_PATTERN.test(e.message)) {
          this.logger.warn("ado.refresh.failed", { code: "network" });
          return err({ code: "network", cause: e.message });
        }
        this.logger.warn("ado.refresh.failed", { code: "auth_failed" });
        return err({ code: "auth_failed", message: e.message });
      }
      this.logger.warn("ado.refresh.failed", { code: "auth_failed" });
      return err({ code: "auth_failed", message: String(e) });
    }

    if (!msalResult) {
      this.logger.warn("ado.refresh.failed", { code: "refresh_expired" });
      return err({ code: "refresh_expired" });
    }

    let newRefreshToken: string;
    try {
      newRefreshToken = extractRefreshToken(msal);
    } catch {
      // Refresh token rotation did not occur; reuse the existing token.
      newRefreshToken = session.refreshToken;
    }

    const newSession = msalResultToSession(msalResult, newRefreshToken);
    await this.tokenStore.save(KEYCHAIN_KEY, newSession);
    this.logger.info("ado.refresh.complete", {
      expiresAt: new Date(newSession.expiresAt).toISOString(),
    });
    return ok(newSession);
  }

  async signOut(session: AuthSession): Promise<Result<void, AuthError>> {
    if (session.provider !== "azure-devops") {
      return err({ code: "auth_failed", message: "session provider mismatch" });
    }

    // Best-effort: attempt server-side token invalidation. A failed
    // revocation request (network down, token already expired) does not
    // block the user from signing out locally.
    try {
      await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/logout", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: AZURE_CLIENT_ID,
          logout_hint: session.upn,
        }).toString(),
      });
    } catch {
      // Swallow — local cleanup proceeds regardless
    }

    await this.tokenStore.delete(KEYCHAIN_KEY);
    this.logger.info("ado.signOut");
    return ok(undefined);
  }
}

export function createAzureDevOpsAuthProvider(
  tokenStore: TokenStore,
  openBrowser: (url: string) => Promise<void>,
  logger?: Logger,
): AzureDevOpsAuthProvider {
  return new AzureDevOpsAuthProvider(tokenStore, openBrowser, undefined, undefined, logger);
}
