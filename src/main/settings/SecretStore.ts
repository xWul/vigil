import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { AsyncEntry } from "@napi-rs/keyring";

const SERVICE = "vigil-secrets";

export interface SecretStore {
  set(key: string, value: string): Promise<void>;
  get(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
}

export class KeychainSecretStore implements SecretStore {
  async set(key: string, value: string): Promise<void> {
    await new AsyncEntry(SERVICE, key).setPassword(value);
  }

  async get(key: string): Promise<string | null> {
    try {
      const value = await new AsyncEntry(SERVICE, key).getPassword();
      return value ?? null;
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await new AsyncEntry(SERVICE, key).deletePassword();
    } catch {
      // not present — no-op
    }
  }
}

type SecretFile = Record<string, string>;

export class FileSecretStore implements SecretStore {
  constructor(private readonly filePath: string) {}

  private read(): SecretFile {
    try {
      return JSON.parse(readFileSync(this.filePath, "utf-8")) as SecretFile;
    } catch {
      return {};
    }
  }

  private write(data: SecretFile): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  set(key: string, value: string): Promise<void> {
    this.write({ ...this.read(), [key]: value });
    return Promise.resolve();
  }

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.read()[key] ?? null);
  }

  delete(key: string): Promise<void> {
    const data = this.read();
    delete data[key];
    this.write(data);
    return Promise.resolve();
  }
}
