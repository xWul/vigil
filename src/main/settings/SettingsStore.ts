import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type { Settings, WritableSettings } from "../../shared/settings.js";
import type { SecretStore } from "./SecretStore.js";

const ANTHROPIC_KEY = "anthropic-api-key";
const OPENAI_KEY = "openai-api-key";

const DEFAULTS: WritableSettings = {
  aiProvider: null,
  model: null,
  logLevel: "error",
};

export class SettingsStore {
  constructor(
    private readonly filePath: string,
    private readonly secrets: SecretStore,
  ) {}

  private read(): WritableSettings {
    try {
      return {
        ...DEFAULTS,
        ...(JSON.parse(readFileSync(this.filePath, "utf-8")) as Partial<WritableSettings>),
      };
    } catch {
      return { ...DEFAULTS };
    }
  }

  private write(data: WritableSettings): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  async get(): Promise<Settings> {
    const persisted = this.read();
    const [hasAnthropicKey, hasOpenAIKey] = await Promise.all([
      this.secrets.get(ANTHROPIC_KEY).then(Boolean),
      this.secrets.get(OPENAI_KEY).then(Boolean),
    ]);
    return { ...persisted, hasAnthropicKey, hasOpenAIKey };
  }

  set(update: Partial<WritableSettings>): Promise<void> {
    this.write({ ...this.read(), ...update });
    return Promise.resolve();
  }

  async setApiKey(provider: "anthropic" | "openai", key: string): Promise<void> {
    await this.secrets.set(provider === "anthropic" ? ANTHROPIC_KEY : OPENAI_KEY, key);
  }

  async deleteApiKey(provider: "anthropic" | "openai"): Promise<void> {
    await this.secrets.delete(provider === "anthropic" ? ANTHROPIC_KEY : OPENAI_KEY);
  }

  async getApiKey(provider: "anthropic" | "openai"): Promise<string | null> {
    return this.secrets.get(provider === "anthropic" ? ANTHROPIC_KEY : OPENAI_KEY);
  }
}
