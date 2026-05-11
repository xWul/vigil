import type { AuthSession } from "./AuthProvider.js";

export interface TokenStore {
  save(key: string, session: AuthSession): Promise<void>;
  load(key: string): Promise<AuthSession | null>;
  delete(key: string): Promise<void>;
}
