import { err, ok } from "../../shared/result.js";
import type { Result } from "../../shared/result.js";
import type { AuthError, AuthProvider, AuthSession, PATSession } from "./AuthProvider.js";
import type { TokenStore } from "./TokenStore.js";

export type AskForPATFn = () => Promise<string>;

export class PATAuthProvider implements AuthProvider {
  readonly id = "pat" as const;
  private readonly key: string;

  constructor(
    private readonly platform: "github" | "azure-devops",
    private readonly tokenStore: TokenStore,
    private readonly askForPAT: AskForPATFn,
  ) {
    this.key = `pat-${platform}`;
  }

  async signIn(): Promise<Result<AuthSession, AuthError>> {
    let raw: string;
    try {
      raw = await this.askForPAT();
    } catch {
      return err({ code: "cancelled" });
    }

    const token = raw.trim();
    if (!token) {
      return err({ code: "auth_failed", message: "empty token" });
    }

    const session: PATSession = {
      provider: "pat",
      platform: this.platform,
      accessToken: token,
    };

    await this.tokenStore.save(this.key, session);
    return ok(session);
  }

  refresh(session: AuthSession): Promise<Result<AuthSession, AuthError>> {
    if (session.provider !== "pat" || session.platform !== this.platform) {
      return Promise.resolve(err({ code: "auth_failed", message: "session provider mismatch" }));
    }
    return Promise.resolve(ok(session));
  }

  async signOut(session: AuthSession): Promise<Result<void, AuthError>> {
    if (session.provider !== "pat" || session.platform !== this.platform) {
      return err({ code: "auth_failed", message: "session provider mismatch" });
    }
    await this.tokenStore.delete(this.key);
    return ok(undefined);
  }
}

export function createPATAuthProvider(
  platform: "github" | "azure-devops",
  tokenStore: TokenStore,
  askForPAT: AskForPATFn,
): PATAuthProvider {
  return new PATAuthProvider(platform, tokenStore, askForPAT);
}
