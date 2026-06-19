import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import type { AnalyzerConfig } from "../../shared/analyzer-config.js";
import type { PRRef } from "../../shared/model/index.js";
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

  getAnalyzerConfig(ref: PRRef): Promise<AnalyzerConfig> {
    const key = analyzerConfigKey(ref);
    const configPath = join(dirname(this.filePath), `${key}.json`);
    try {
      return Promise.resolve(JSON.parse(readFileSync(configPath, "utf-8")) as AnalyzerConfig);
    } catch {
      return Promise.resolve({});
    }
  }

  setAnalyzerConfig(ref: PRRef, config: AnalyzerConfig): Promise<void> {
    const key = analyzerConfigKey(ref);
    const configPath = join(dirname(this.filePath), `${key}.json`);
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    return Promise.resolve();
  }

  getSuppressed(ref: PRRef, headSha: string): Promise<readonly string[]> {
    const filePath = join(dirname(this.filePath), `${suppressionsKey(ref)}.json`);
    try {
      const all = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, string[]>;
      return Promise.resolve(all[headSha] ?? []);
    } catch {
      return Promise.resolve([]);
    }
  }

  setSuppressed(ref: PRRef, headSha: string, keys: readonly string[]): Promise<void> {
    const filePath = join(dirname(this.filePath), `${suppressionsKey(ref)}.json`);
    let all: Record<string, string[]> = {};
    try {
      all = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, string[]>;
    } catch {
      // file doesn't exist yet
    }
    if (keys.length === 0) {
      delete all[headSha];
    } else {
      all[headSha] = [...keys];
    }
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(all, null, 2), "utf-8");
    return Promise.resolve();
  }
}

function analyzerConfigKey(ref: PRRef): string {
  if (ref.platform === "github") {
    return `analyzer-config.github.${ref.owner}.${ref.repo}`;
  }
  return `analyzer-config.azure-devops.${ref.org}.${ref.project}.${ref.repo}`;
}

function suppressionsKey(ref: PRRef): string {
  if (ref.platform === "github") {
    return `suppressed-findings.github.${ref.owner}.${ref.repo}`;
  }
  return `suppressed-findings.azure-devops.${ref.org}.${ref.project}.${ref.repo}`;
}
