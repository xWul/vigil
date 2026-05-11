import { AsyncEntry } from "@napi-rs/keyring";

import type { AuthSession } from "./AuthProvider.js";
import type { TokenStore } from "./TokenStore.js";

const SERVICE = "vigil";

export class KeychainTokenStore implements TokenStore {
  async save(key: string, session: AuthSession): Promise<void> {
    const entry = new AsyncEntry(SERVICE, key);
    await entry.setPassword(JSON.stringify(session));
  }

  async load(key: string): Promise<AuthSession | null> {
    const entry = new AsyncEntry(SERVICE, key);
    try {
      const raw = await entry.getPassword();
      if (raw === undefined || raw === null) return null;
      return JSON.parse(raw) as AuthSession;
    } catch {
      // NoEntry or platform unavailable — treat as not found
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const entry = new AsyncEntry(SERVICE, key);
    try {
      await entry.deletePassword();
    } catch {
      // NoEntry — already gone, that's fine
    }
  }
}
