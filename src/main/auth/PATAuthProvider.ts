import { err, ok } from "../../shared/result.js";
import type { Result } from "../../shared/result.js";
import { NoopLogger } from "../../shared/logger.js";
import type { Logger } from "../../shared/logger.js";
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
    private readonly logger: Logger = new NoopLogger(),
  ) {
    this.key = `pat-${platform}`;
  }

  async signIn(): Promise<Result<AuthSession, AuthError>> {
    let raw: string;
    try {
      raw = await this.askForPAT();
    } catch {
      this.logger.warn("pat.signIn.failed", { code: "cancelled" });
      return err({ code: "cancelled" });
    }

    const token = raw.trim();
    if (!token) {
      this.logger.warn("pat.signIn.failed", { code: "auth_failed" });
      return err({ code: "auth_failed", message: "empty token" });
    }

    const session: PATSession = {
      provider: "pat",
      platform: this.platform,
      accessToken: token,
    };

    await this.tokenStore.save(this.key, session);
    this.logger.info("pat.signIn.complete", { platform: this.platform });
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
    this.logger.info("pat.signOut", { platform: this.platform });
    return ok(undefined);
  }
}

export function createPATAuthProvider(
  platform: "github" | "azure-devops",
  tokenStore: TokenStore,
  askForPAT: AskForPATFn,
  logger?: Logger,
): PATAuthProvider {
  return new PATAuthProvider(platform, tokenStore, askForPAT, logger);
}
