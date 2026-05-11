import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { AuthSession } from "./AuthProvider.js";
import type { TokenStore } from "./TokenStore.js";

type StoreFile = Record<string, AuthSession>;

/**
 * File-backed TokenStore for development and CI environments where the OS
 * keychain is unavailable. Do not use in production — sessions are stored
 * as plain JSON.
 */
export class FileTokenStore implements TokenStore {
  constructor(private readonly filePath: string) {}

  async save(key: string, session: AuthSession): Promise<void> {
    const store = await this.#read();
    store[key] = session;
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(store, null, 2), "utf8");
  }

  async load(key: string): Promise<AuthSession | null> {
    const store = await this.#read();
    return store[key] ?? null;
  }

  async delete(key: string): Promise<void> {
    const store = await this.#read();
    if (!(key in store)) return;
    delete store[key];
    if (Object.keys(store).length === 0) {
      await unlink(this.filePath).catch(() => undefined);
    } else {
      await writeFile(this.filePath, JSON.stringify(store, null, 2), "utf8");
    }
  }

  async #read(): Promise<StoreFile> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return JSON.parse(raw) as StoreFile;
    } catch {
      return {};
    }
  }
}
