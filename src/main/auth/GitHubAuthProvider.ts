import { err, ok } from "../../shared/result.js";
import type { Result } from "../../shared/result.js";
import type { AuthError, AuthProvider, AuthSession, GitHubSession } from "./AuthProvider.js";
import type { TokenStore } from "./TokenStore.js";

// Public client ID — not a secret, safe to ship in source.
// TODO: replace with the registered GitHub OAuth App client ID before shipping.
export const GITHUB_CLIENT_ID = "Ov23liYszuNkzjfiWTiH";

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";
const SCOPES = "repo read:org";
const KEYCHAIN_KEY = "github";

export type FetchFn = typeof fetch;
export type SleepFn = (ms: number) => Promise<void>;

// ---------------------------------------------------------------------------
// Internal response types (cast at network boundaries)
// ---------------------------------------------------------------------------

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface TokenSuccessResponse {
  access_token: string;
}

interface TokenErrorResponse {
  error: string;
  error_description?: string;
}

type TokenPollResponse = TokenSuccessResponse | TokenErrorResponse;

interface GitHubUserResponse {
  login: string;
  name: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function networkErr(e: unknown): Result<never, AuthError> {
  return err({ code: "network", cause: e instanceof Error ? e.message : String(e) });
}

async function requestDeviceCode(fetchFn: FetchFn): Promise<Result<DeviceCodeResponse, AuthError>> {
  let response: Response;
  try {
    response = await fetchFn(DEVICE_CODE_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: GITHUB_CLIENT_ID,
        scope: SCOPES,
      }).toString(),
    });
  } catch (e) {
    return networkErr(e);
  }

  return ok((await response.json()) as DeviceCodeResponse);
}

type PollResult =
  | { readonly ok: true; readonly accessToken: string }
  | { readonly ok: false; readonly error: AuthError };

async function pollForToken(
  deviceCode: string,
  intervalMs: number,
  fetchFn: FetchFn,
  sleep: SleepFn,
): Promise<PollResult> {
  let currentIntervalMs = intervalMs;

  while (true) {
    await sleep(currentIntervalMs);

    let response: Response;
    try {
      response = await fetchFn(ACCESS_TOKEN_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: GITHUB_CLIENT_ID,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }).toString(),
      });
    } catch (e) {
      return {
        ok: false,
        error: { code: "network", cause: e instanceof Error ? e.message : String(e) },
      };
    }

    const data = (await response.json()) as TokenPollResponse;

    if ("access_token" in data) {
      return { ok: true, accessToken: data.access_token };
    }

    switch (data.error) {
      case "authorization_pending":
        continue;
      case "slow_down":
        currentIntervalMs += 5_000;
        continue;
      case "expired_token":
        return { ok: false, error: { code: "timeout" } };
      case "access_denied":
        return { ok: false, error: { code: "consent_denied" } };
      default:
        return {
          ok: false,
          error: {
            code: "auth_failed",
            message: data.error_description ?? data.error,
          },
        };
    }
  }
}

async function fetchUser(
  accessToken: string,
  fetchFn: FetchFn,
): Promise<Result<GitHubUserResponse, AuthError>> {
  let response: Response;
  try {
    response = await fetchFn(USER_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } catch (e) {
    return networkErr(e);
  }

  return ok((await response.json()) as GitHubUserResponse);
}

// ---------------------------------------------------------------------------
// GitHubAuthProvider
// ---------------------------------------------------------------------------

export class GitHubAuthProvider implements AuthProvider {
  readonly id = "github" as const;

  constructor(
    private readonly tokenStore: TokenStore,
    private readonly presentDeviceCode: (
      userCode: string,
      verificationUri: string,
    ) => Promise<void>,
    private readonly fetchFn: FetchFn = fetch,
    private readonly sleep: SleepFn = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async signIn(): Promise<Result<AuthSession, AuthError>> {
    const deviceCodeResult = await requestDeviceCode(this.fetchFn);
    if (!deviceCodeResult.ok) return deviceCodeResult;

    const { device_code, user_code, verification_uri, interval } = deviceCodeResult.value;

    await this.presentDeviceCode(user_code, verification_uri);

    const pollResult = await pollForToken(device_code, interval * 1_000, this.fetchFn, this.sleep);
    if (!pollResult.ok) return err(pollResult.error);

    const userResult = await fetchUser(pollResult.accessToken, this.fetchFn);
    if (!userResult.ok) return userResult;

    const { login, name } = userResult.value;
    const session: GitHubSession = {
      provider: "github",
      accessToken: pollResult.accessToken,
      login,
      displayName: name ?? login,
    };

    await this.tokenStore.save(KEYCHAIN_KEY, session);
    return ok(session);
  }

  refresh(session: AuthSession): Promise<Result<AuthSession, AuthError>> {
    if (session.provider !== "github") {
      return Promise.resolve(err({ code: "auth_failed", message: "session provider mismatch" }));
    }
    // GitHub OAuth App tokens do not expire. See docs/specs/auth-github.md.
    return Promise.resolve(ok(session));
  }

  async signOut(session: AuthSession): Promise<Result<void, AuthError>> {
    if (session.provider !== "github") {
      return err({ code: "auth_failed", message: "session provider mismatch" });
    }
    // Local-only: no client_secret means no programmatic revocation.
    // See docs/specs/auth-github.md § Sign-out.
    await this.tokenStore.delete(KEYCHAIN_KEY);
    return ok(undefined);
  }
}

export function createGitHubAuthProvider(
  tokenStore: TokenStore,
  presentDeviceCode: (userCode: string, verificationUri: string) => Promise<void>,
): GitHubAuthProvider {
  return new GitHubAuthProvider(tokenStore, presentDeviceCode);
}
