import { useState, useEffect } from "react";

import type { ConnectedAccount } from "../../../shared/auth.js";
import type { Settings as SettingsData } from "../../../shared/settings.js";
import { api } from "../../api.js";
import { TOKENS, SANS, MONO } from "../../shared/theme.js";

type Platform = "github" | "azure-devops";
type AiProvider = "anthropic" | "openai";
type SaveState = "idle" | "saving" | "saved" | "error";

// ── Icons ─────────────────────────────────────────────────────────────────────

function GitHubIcon({ color }: { color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill={color}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function AzureIcon({ color }: { color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path
        d="M9.16 1L5.12 5.34 1 12.16h3.56L9.16 1zM9.88 2.04l-2.2 5.88 3.84 4.32-7.04 1.72H15L9.88 2.04z"
        fill={color}
      />
    </svg>
  );
}

function TrafficLights() {
  const t = TOKENS.dark;
  const dot = (c: string) => (
    <span
      style={{ width: 12, height: 12, borderRadius: "50%", background: c, display: "inline-block" }}
    />
  );
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      {dot(t.trafficR)}
      {dot(t.trafficY)}
      {dot(t.trafficG)}
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const t = TOKENS.dark;
  return (
    <div style={{ marginBottom: 32 }}>
      <div
        style={{
          fontFamily: SANS,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase" as const,
          color: t.textFaint,
          marginBottom: 12,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

// ── Account row ───────────────────────────────────────────────────────────────

function AccountRow({
  account,
  busy,
  onSignOut,
}: {
  account: ConnectedAccount;
  busy: boolean;
  onSignOut: () => void;
}) {
  const t = TOKENS.dark;
  const isGitHub = account.platform === "github";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        background: t.surface,
        borderRadius: 8,
        marginBottom: 8,
      }}
    >
      {isGitHub ? <GitHubIcon color={t.textDim} /> : <AzureIcon color={t.textDim} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: SANS,
            fontSize: 13,
            fontWeight: 500,
            color: t.text,
            lineHeight: 1.3,
          }}
        >
          {account.displayName}
        </div>
        <div style={{ fontFamily: MONO, fontSize: 11, color: t.textFaint, marginTop: 1 }}>
          {account.login}
        </div>
      </div>
      <button
        onClick={onSignOut}
        disabled={busy}
        style={{
          fontFamily: SANS,
          fontSize: 12,
          color: busy ? t.textFaint : t.red,
          background: "none",
          border: `1px solid ${busy ? t.border : "rgba(248,113,113,0.25)"}`,
          borderRadius: 6,
          padding: "4px 10px",
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.5 : 1,
          transition: "opacity 150ms",
        }}
      >
        {busy ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}

// ── Provider toggle ───────────────────────────────────────────────────────────

function ProviderToggle({
  value,
  onChange,
}: {
  value: AiProvider | null;
  onChange: (p: AiProvider) => void;
}) {
  const t = TOKENS.dark;

  const btn = (p: AiProvider, label: string) => {
    const active = value === p;
    return (
      <button
        key={p}
        onClick={() => onChange(p)}
        style={{
          flex: 1,
          fontFamily: SANS,
          fontSize: 13,
          fontWeight: active ? 500 : 400,
          color: active ? t.text : t.textDim,
          background: active ? t.selected : "none",
          border: "none",
          borderRadius: 6,
          padding: "7px 0",
          cursor: "pointer",
          transition: "background 150ms, color 150ms",
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div
      style={{
        display: "flex",
        background: t.surface,
        borderRadius: 8,
        padding: 3,
        gap: 2,
      }}
    >
      {btn("anthropic", "Anthropic")}
      {btn("openai", "OpenAI")}
    </div>
  );
}

// ── API key field ─────────────────────────────────────────────────────────────

function ApiKeyField({
  provider,
  hasKey,
  onSave,
  onDelete,
}: {
  provider: AiProvider;
  hasKey: boolean;
  onSave: (key: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const t = TOKENS.dark;
  const [value, setValue] = useState("");
  const [state, setState] = useState<SaveState>("idle");

  const placeholder = provider === "anthropic" ? "sk-ant-api03-…" : "sk-proj-…";

  async function handleSave() {
    if (!value.trim()) return;
    setState("saving");
    try {
      await onSave(value.trim());
      setValue("");
      setState("saved");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("error");
    }
  }

  async function handleDelete() {
    setState("saving");
    try {
      await onDelete();
      setState("idle");
    } catch {
      setState("error");
    }
  }

  if (hasKey && state !== "error") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            flex: 1,
            fontFamily: MONO,
            fontSize: 13,
            color: t.textFaint,
            background: t.surface,
            borderRadius: 8,
            padding: "9px 12px",
            letterSpacing: "0.12em",
          }}
        >
          ••••••••••••••••••••
        </div>
        <button
          onClick={() => void handleDelete()}
          disabled={state === "saving"}
          style={{
            fontFamily: SANS,
            fontSize: 12,
            color: state === "saving" ? t.textFaint : t.red,
            background: "none",
            border: `1px solid ${state === "saving" ? t.border : "rgba(248,113,113,0.25)"}`,
            borderRadius: 6,
            padding: "8px 14px",
            cursor: state === "saving" ? "default" : "pointer",
          }}
        >
          {state === "saving" ? "Removing…" : "Remove"}
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleSave();
          }}
          placeholder={placeholder}
          disabled={state === "saving"}
          style={{
            flex: 1,
            fontFamily: MONO,
            fontSize: 13,
            color: t.text,
            background: t.surface,
            border: `1px solid ${t.border}`,
            borderRadius: 8,
            padding: "9px 12px",
            outline: "none",
          }}
        />
        <button
          onClick={() => void handleSave()}
          disabled={!value.trim() || state === "saving"}
          style={{
            fontFamily: SANS,
            fontSize: 13,
            fontWeight: 500,
            color: !value.trim() || state === "saving" ? t.textFaint : t.bg,
            background: !value.trim() || state === "saving" ? t.surface : t.accent,
            border: "none",
            borderRadius: 8,
            padding: "9px 18px",
            cursor: !value.trim() || state === "saving" ? "default" : "pointer",
            transition: "background 150ms, color 150ms",
          }}
        >
          {state === "saving" ? "Saving…" : "Save"}
        </button>
      </div>
      {state === "saved" && (
        <span style={{ fontFamily: SANS, fontSize: 12, color: t.green }}>Saved</span>
      )}
      {state === "error" && (
        <span style={{ fontFamily: SANS, fontSize: 12, color: t.red }}>
          Failed — try again
        </span>
      )}
    </div>
  );
}

// ── Settings ──────────────────────────────────────────────────────────────────

export function Settings({
  accounts: initialAccounts,
  onClose,
}: {
  accounts: readonly ConnectedAccount[];
  onClose: (accounts: readonly ConnectedAccount[]) => void;
}) {
  const t = TOKENS.dark;
  const [accounts, setAccounts] = useState<readonly ConnectedAccount[]>(initialAccounts);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [signingOut, setSigningOut] = useState<Platform | null>(null);

  useEffect(() => {
    void api.invoke("settings:get").then((r) => {
      if (r.ok) setSettings(r.value);
    });
  }, []);

  async function handleSignOut(platform: Platform) {
    setSigningOut(platform);
    await api.invoke("auth:signOut", platform);
    const r = await api.invoke("auth:getAccounts");
    const updated = r.ok ? r.value : ([] as readonly ConnectedAccount[]);
    setSigningOut(null);
    setAccounts(updated);
    if (updated.length === 0) onClose([]);
  }

  async function handleSetProvider(provider: AiProvider) {
    await api.invoke("settings:set", { aiProvider: provider });
    setSettings((s) => (s ? { ...s, aiProvider: provider } : s));
  }

  async function handleSaveKey(provider: AiProvider, key: string) {
    await api.invoke("settings:setApiKey", provider, key);
    setSettings((s) =>
      s
        ? {
            ...s,
            hasAnthropicKey: provider === "anthropic" ? true : s.hasAnthropicKey,
            hasOpenAIKey: provider === "openai" ? true : s.hasOpenAIKey,
          }
        : s,
    );
  }

  async function handleDeleteKey(provider: AiProvider) {
    await api.invoke("settings:deleteApiKey", provider);
    setSettings((s) =>
      s
        ? {
            ...s,
            hasAnthropicKey: provider === "anthropic" ? false : s.hasAnthropicKey,
            hasOpenAIKey: provider === "openai" ? false : s.hasOpenAIKey,
          }
        : s,
    );
  }

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: t.bg,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Draggable titlebar */}
      <div
        style={
          {
            height: 52,
            display: "flex",
            alignItems: "center",
            padding: "0 20px",
            WebkitAppRegion: "drag",
            flexShrink: 0,
          } as React.CSSProperties
        }
      >
        <div style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <TrafficLights />
        </div>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 0 48px" }}>
        <div style={{ maxWidth: 480, margin: "0 auto", padding: "0 32px" }}>
          {/* Back + title */}
          <div
            style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 36 }}
          >
            <button
              onClick={() => onClose(accounts)}
              style={{
                fontFamily: SANS,
                fontSize: 13,
                color: t.textDim,
                background: "none",
                border: "none",
                padding: "4px 0",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <span style={{ fontSize: 15, lineHeight: 1 }}>←</span>
              Back
            </button>
            <span style={{ color: t.border }}>·</span>
            <span
              style={{
                fontFamily: SANS,
                fontSize: 15,
                fontWeight: 600,
                color: t.text,
                letterSpacing: "-0.01em",
              }}
            >
              Settings
            </span>
          </div>

          <Section title="Accounts">
            {accounts.length === 0 ? (
              <p style={{ fontFamily: SANS, fontSize: 13, color: t.textFaint, margin: 0 }}>
                No connected accounts.
              </p>
            ) : (
              accounts.map((a) => (
                <AccountRow
                  key={a.platform}
                  account={a}
                  busy={signingOut === a.platform}
                  onSignOut={() => void handleSignOut(a.platform)}
                />
              ))
            )}
          </Section>

          <Section title="AI Provider">
            <ProviderToggle
              value={settings?.aiProvider ?? null}
              onChange={(p) => void handleSetProvider(p)}
            />
          </Section>

          {settings && (
            <>
              <Section title="Anthropic API Key">
                <ApiKeyField
                  provider="anthropic"
                  hasKey={settings.hasAnthropicKey}
                  onSave={(key) => handleSaveKey("anthropic", key)}
                  onDelete={() => handleDeleteKey("anthropic")}
                />
              </Section>

              <Section title="OpenAI API Key">
                <ApiKeyField
                  provider="openai"
                  hasKey={settings.hasOpenAIKey}
                  onSave={(key) => handleSaveKey("openai", key)}
                  onDelete={() => handleDeleteKey("openai")}
                />
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
