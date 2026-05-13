export interface Settings {
  readonly aiProvider: "anthropic" | "openai" | null;
  readonly model: string | null;
  readonly logLevel: "debug" | "info" | "warn" | "error";
  readonly hasAnthropicKey: boolean;
  readonly hasOpenAIKey: boolean;
}

export type WritableSettings = Omit<Settings, "hasAnthropicKey" | "hasOpenAIKey">;

export type SettingsError =
  | { readonly code: "write_failed"; readonly message: string }
  | { readonly code: "keychain_unavailable" };
