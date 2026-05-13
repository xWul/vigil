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

interface SecretFile {
  [key: string]: string;
}

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

  async set(key: string, value: string): Promise<void> {
    this.write({ ...this.read(), [key]: value });
  }

  async get(key: string): Promise<string | null> {
    return this.read()[key] ?? null;
  }

  async delete(key: string): Promise<void> {
    const data = this.read();
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete data[key];
    this.write(data);
  }
}
