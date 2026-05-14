import { useState, useEffect, useRef } from "react";

import type { ConnectedAccount } from "../../../shared/auth.js";
import type { Settings as SettingsData } from "../../../shared/settings.js";
import { api } from "../../api.js";
import { TOKENS, SANS, MONO } from "../../shared/theme.js";

type Platform = "github" | "azure-devops";
type AiProvider = "anthropic" | "openai";

// ── Brand marks ───────────────────────────────────────────────────────────────

function GitHubMark({ size = 18, color }: { size?: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ display: "block" }}>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55v-1.93c-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.09-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.78 0c2.21-1.49 3.18-1.18 3.18-1.18.62 1.58.23 2.75.11 3.04.74.8 1.18 1.83 1.18 3.09 0 4.42-2.69 5.39-5.25 5.68.41.35.78 1.05.78 2.12v3.14c0 .3.21.66.79.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}

function AzureDevOpsMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block" }}>
      <defs>
        <linearGradient id="azdo-settings-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0078d4" />
          <stop offset="100%" stopColor="#005a9e" />
        </linearGradient>
      </defs>
      <path
        d="M22.5 6.4v11.7l-4.7 3.9-7.5-2.7v2.6L6.2 17 18 17.9V7.3l4.5-.9zM18 7.3L11 1.5l-3.4 3v3.9L1.5 10.3l2.1 2.7v6L11 22.5v-7.7l7-2.5z"
        fill="url(#azdo-settings-g)"
      />
    </svg>
  );
}

// ── Provider data ─────────────────────────────────────────────────────────────

const PROVIDER_INFO: Record<
  AiProvider,
  { name: string; description: string; modelsHint: string; models: string[] }
> = {
  anthropic: {
    name: "Anthropic",
    description: "Claude family — strong reasoning over long contexts.",
    modelsHint: "Sonnet · Opus · Haiku",
    models: ["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5-20251001"],
  },
  openai: {
    name: "OpenAI",
    description: "GPT family — broad model coverage.",
    modelsHint: "GPT-5 · GPT-4.1 · o4",
    models: ["gpt-5", "gpt-4.1", "o4-mini"],
  },
};

const MODEL_LABELS: Record<string, string> = {
  "claude-sonnet-4-6": "Claude Sonnet 4.6",
  "claude-opus-4-7": "Claude Opus 4.7",
  "claude-haiku-4-5-20251001": "Claude Haiku 4.5",
  "gpt-5": "GPT-5",
  "gpt-4.1": "GPT-4.1",
  "o4-mini": "o4-mini",
};

// ── Atoms ─────────────────────────────────────────────────────────────────────

function SectionHeading({ title, subtitle }: { title: string; subtitle: string }) {
  const t = TOKENS.dark;
  return (
    <div style={{ marginBottom: 28 }}>
      <h2
        style={{
          margin: 0,
          fontSize: 18,
          fontWeight: 500,
          letterSpacing: "-0.012em",
          color: t.text,
          fontFamily: SANS,
        }}
      >
        {title}
      </h2>
      <p
        style={{
          margin: "6px 0 0",
          fontSize: 13.5,
          color: t.textDim,
          letterSpacing: "-0.003em",
          lineHeight: 1.5,
          fontFamily: SANS,
        }}
      >
        {subtitle}
      </p>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  const t = TOKENS.dark;
  return (
    <div
      style={{
        fontSize: 12.5,
        color: t.textDim,
        fontWeight: 450,
        marginBottom: 10,
        fontFamily: SANS,
        letterSpacing: "-0.003em",
      }}
    >
      {children}
    </div>
  );
}

function SectionDivider() {
  const t = TOKENS.dark;
  return <div style={{ height: 1, background: t.border, margin: "52px 0" }} />;
}

// ── Connected account row ─────────────────────────────────────────────────────

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
  const platformLabel = isGitHub ? "GitHub" : "Azure DevOps";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "28px 1fr auto",
        gap: 16,
        alignItems: "center",
        padding: "18px 0",
        borderBottom: `0.5px solid ${t.border}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
        }}
      >
        {isGitHub ? <GitHubMark size={18} color={t.text} /> : <AzureDevOpsMark size={18} />}
      </div>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            color: t.text,
            letterSpacing: "-0.005em",
            fontFamily: SANS,
          }}
        >
          {platformLabel}
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 12.5,
            color: t.textDim,
            fontFamily: SANS,
          }}
        >
          Signed in as <span style={{ fontFamily: MONO, color: t.text }}>{account.login}</span>
        </div>
      </div>
      <button
        onClick={onSignOut}
        disabled={busy}
        style={{
          background: "none",
          border: 0,
          padding: 0,
          fontFamily: SANS,
          fontSize: 13,
          color: busy ? t.textFaint : t.textDim,
          cursor: busy ? "default" : "pointer",
          transition: "color .12s",
        }}
      >
        {busy ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}

// ── Provider radio row ────────────────────────────────────────────────────────

function ProviderRow({
  provider,
  selected,
  onClick,
}: {
  provider: AiProvider;
  selected: boolean;
  onClick: () => void;
}) {
  const t = TOKENS.dark;
  const info = PROVIDER_INFO[provider];

  return (
    <div
      onClick={onClick}
      style={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: "22px 1fr auto",
        gap: 14,
        alignItems: "center",
        padding: "14px 14px 14px 16px",
        borderRadius: 6,
        cursor: "default",
        background: selected ? t.selected : "transparent",
        transition: "background .12s",
      }}
    >
      {selected && (
        <span
          style={{
            position: "absolute",
            left: 0,
            top: 10,
            bottom: 10,
            width: 2,
            background: t.accent,
            borderRadius: 2,
          }}
        />
      )}
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: "50%",
          border: `1.5px solid ${selected ? t.accent : t.textFaint}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "border-color .12s",
          flexShrink: 0,
        }}
      >
        {selected && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: t.accent,
            }}
          />
        )}
      </span>
      <div>
        <div
          style={{
            fontSize: 14,
            color: t.text,
            letterSpacing: "-0.005em",
            fontFamily: SANS,
          }}
        >
          {info.name}
        </div>
        <div
          style={{
            marginTop: 3,
            fontSize: 12,
            color: t.textDim,
            fontFamily: SANS,
          }}
        >
          {info.description}
        </div>
      </div>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 11,
          color: t.textFaint,
        }}
      >
        {info.modelsHint}
      </div>
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
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const placeholder = provider === "anthropic" ? "sk-ant-api03-…" : "sk-proj-…";

  async function handleSave() {
    if (!value.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(value.trim());
      setValue("");
    } catch {
      setSaveError("Failed to save — try again");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setSaving(true);
    setSaveError(null);
    try {
      await onDelete();
    } catch {
      setSaveError("Failed to remove key");
    } finally {
      setSaving(false);
    }
  }

  if (hasKey) {
    return (
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            borderBottom: `1px solid ${t.border}`,
          }}
        >
          <div
            style={{
              flex: 1,
              fontFamily: MONO,
              fontSize: 13.5,
              color: t.text,
              padding: "10px 0",
              letterSpacing: "0.08em",
            }}
          >
            {"•".repeat(32)}
          </div>
          <button
            onClick={() => void handleDelete()}
            disabled={saving}
            style={{
              marginLeft: 16,
              fontSize: 12,
              padding: "4px 0",
              background: "none",
              border: 0,
              fontFamily: SANS,
              color: saving ? t.textFaint : t.textDim,
              cursor: saving ? "default" : "pointer",
              transition: "color .12s",
            }}
          >
            {saving ? "Removing…" : "Remove"}
          </button>
        </div>
        {saveError && (
          <div
            style={{
              marginTop: 6,
              fontSize: 12,
              color: t.red,
              fontFamily: SANS,
            }}
          >
            {saveError}
          </div>
        )}
        <div
          style={{
            marginTop: 10,
            fontSize: 11.5,
            color: t.textFaint,
            lineHeight: 1.55,
            fontFamily: MONO,
          }}
        >
          Your key is stored in your OS keychain and never leaves your machine.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          borderBottom: `1px solid ${revealed ? t.accent : t.border}`,
          transition: "border-color .12s",
        }}
      >
        <input
          type={revealed ? "text" : "password"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleSave();
          }}
          placeholder={placeholder}
          disabled={saving}
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: MONO,
            fontSize: 13.5,
            letterSpacing: "0.01em",
            color: t.text,
            background: "transparent",
            border: 0,
            outline: "none",
            padding: "10px 0",
          }}
        />
        <button
          onClick={() => setRevealed((r) => !r)}
          style={{
            marginLeft: 16,
            fontSize: 12,
            padding: "4px 0",
            minWidth: 38,
            textAlign: "right",
            background: "none",
            border: 0,
            fontFamily: SANS,
            color: t.textDim,
            cursor: "pointer",
          }}
        >
          {revealed ? "Hide" : "Show"}
        </button>
      </div>
      {saveError && (
        <div
          style={{
            marginTop: 6,
            fontSize: 12,
            color: t.red,
            fontFamily: SANS,
          }}
        >
          {saveError}
        </div>
      )}
      {value.trim() && (
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          style={{
            marginTop: 10,
            padding: "6px 14px",
            borderRadius: 6,
            border: 0,
            background: saving ? t.border : t.accent,
            color: saving ? t.textFaint : t.bg,
            fontFamily: SANS,
            fontSize: 12.5,
            fontWeight: 500,
            cursor: saving ? "default" : "pointer",
          }}
        >
          {saving ? "Saving…" : "Save key"}
        </button>
      )}
      <div
        style={{
          marginTop: 10,
          fontSize: 11.5,
          color: t.textFaint,
          lineHeight: 1.55,
          fontFamily: MONO,
        }}
      >
        Your key is stored in your OS keychain and never leaves your machine.
      </div>
    </div>
  );
}

// ── Model dropdown ────────────────────────────────────────────────────────────

function ModelDropdown({
  provider,
  value,
  onChange,
}: {
  provider: AiProvider;
  value: string | null;
  onChange: (m: string) => void;
}) {
  const t = TOKENS.dark;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const options = PROVIDER_INFO[provider].models;
  const current = value && options.includes(value) ? value : (options[0] ?? "");
  const label = MODEL_LABELS[current] ?? current;

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          width: "100%",
          border: 0,
          borderBottom: `1px solid ${t.border}`,
          padding: "10px 0",
          background: "transparent",
          cursor: "default",
        }}
      >
        <span
          style={{
            flex: 1,
            textAlign: "left",
            fontSize: 14,
            color: t.text,
            letterSpacing: "-0.003em",
            fontFamily: SANS,
          }}
        >
          {label}
        </span>
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
          <path
            d="M2 4.2l3.5 3 3.5-3"
            stroke={t.textDim}
            strokeWidth="1.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 4,
            background: t.surface,
            borderRadius: 8,
            padding: 4,
            border: `0.5px solid ${t.border}`,
            boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
            zIndex: 5,
          }}
        >
          {options.map((o) => (
            <button
              key={o}
              onClick={() => {
                onChange(o);
                setOpen(false);
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "7px 10px",
                borderRadius: 6,
                border: 0,
                background: o === current ? t.selected : "transparent",
                color: o === current ? t.text : t.textDim,
                fontFamily: SANS,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              {MODEL_LABELS[o] ?? o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Segmented control ─────────────────────────────────────────────────────────

function Segmented({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const t = TOKENS.dark;
  return (
    <div
      style={{
        display: "inline-flex",
        padding: 3,
        borderRadius: 7,
        background: t.surface,
        border: `0.5px solid ${t.border}`,
      }}
    >
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          style={{
            border: 0,
            padding: "7px 18px",
            borderRadius: 5,
            fontFamily: SANS,
            fontSize: 13,
            cursor: "pointer",
            background: value === opt ? t.selected : "transparent",
            color: value === opt ? t.text : t.textDim,
            letterSpacing: "-0.003em",
            transition: "color .12s, background .12s",
          }}
        >
          {opt}
        </button>
      ))}
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
  const [theme, setTheme] = useState("Dark");
  const [diagCopied, setDiagCopied] = useState(false);

  useEffect(() => {
    void api.invoke("settings:get").then((r) => {
      if (r.ok) setSettings(r.value);
    });
  }, []);

  async function handleCopyDiagnostics() {
    await api.invoke("app:copyDiagnostics");
    setDiagCopied(true);
    setTimeout(() => setDiagCopied(false), 2000);
  }

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

  async function handleSetModel(model: string) {
    await api.invoke("settings:set", { model });
    setSettings((s) => (s ? { ...s, model } : s));
  }

  const selectedProvider = settings?.aiProvider ?? null;
  const hasKey =
    selectedProvider === "anthropic"
      ? (settings?.hasAnthropicKey ?? false)
      : selectedProvider === "openai"
        ? (settings?.hasOpenAIKey ?? false)
        : false;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: t.bg,
        display: "flex",
        flexDirection: "column",
        color: t.text,
        fontFamily: SANS,
      }}
    >
      {/* Top strip */}
      <div
        style={
          {
            display: "flex",
            alignItems: "center",
            gap: 18,
            padding: "0 28px",
            height: 52,
            flexShrink: 0,
            borderBottom: `0.5px solid ${t.border}`,
            WebkitAppRegion: "drag",
          } as React.CSSProperties
        }
      >
        <button
          onClick={() => onClose(accounts)}
          style={
            {
              WebkitAppRegion: "no-drag",
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              color: t.textDim,
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              fontFamily: SANS,
              transition: "color .12s",
            } as React.CSSProperties
          }
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path
              d="M7 2L3.5 5.5L7 9"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Queue
        </button>
        <div style={{ width: 0.5, height: 18, background: t.border }} />
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            letterSpacing: "-0.005em",
          }}
        >
          Settings
        </div>
        <div style={{ flex: 1 }} />
        <div
          style={
            {
              WebkitAppRegion: "no-drag",
              fontFamily: MONO,
              fontSize: 11,
              color: t.textFaint,
              display: "flex",
              alignItems: "center",
              gap: 8,
            } as React.CSSProperties
          }
        >
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: t.green,
              display: "inline-block",
            }}
          />
          changes save automatically
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "56px 32px 80px" }}>
          {/* ── 1. Connected accounts ── */}
          <SectionHeading
            title="Connected accounts"
            subtitle="Sign-in state for the platforms Vigil watches."
          />
          <div style={{ borderTop: `0.5px solid ${t.border}` }}>
            {accounts.length === 0 ? (
              <div
                style={{
                  padding: "18px 0",
                  fontSize: 13.5,
                  color: t.textFaint,
                }}
              >
                No connected accounts.
              </div>
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
          </div>

          <SectionDivider />

          {/* ── 2. AI provider ── */}
          <SectionHeading
            title="AI provider"
            subtitle="The model Vigil uses to summarize PRs and surface risks."
          />

          <div style={{ marginBottom: 36 }}>
            <FieldLabel>Provider</FieldLabel>
            <div style={{ marginLeft: -16 }}>
              {(["anthropic", "openai"] as AiProvider[]).map((p) => (
                <ProviderRow
                  key={p}
                  provider={p}
                  selected={selectedProvider === p}
                  onClick={() => void handleSetProvider(p)}
                />
              ))}
            </div>
          </div>

          {selectedProvider && (
            <>
              <div style={{ marginBottom: 36 }}>
                <FieldLabel>API key</FieldLabel>
                <ApiKeyField
                  provider={selectedProvider}
                  hasKey={hasKey}
                  onSave={(key) => handleSaveKey(selectedProvider, key)}
                  onDelete={() => handleDeleteKey(selectedProvider)}
                />
              </div>

              <div>
                <FieldLabel>Model</FieldLabel>
                <ModelDropdown
                  provider={selectedProvider}
                  value={settings?.model ?? null}
                  onChange={(m) => void handleSetModel(m)}
                />
              </div>
            </>
          )}

          <SectionDivider />

          {/* ── 3. Appearance ── */}
          <SectionHeading title="Appearance" subtitle="How Vigil looks on your machine." />

          <div>
            <FieldLabel>Theme</FieldLabel>
            <Segmented options={["System", "Light", "Dark"]} value={theme} onChange={setTheme} />
          </div>

          <SectionDivider />

          {/* ── 4. Diagnostics ── */}
          <SectionHeading
            title="Diagnostics"
            subtitle="Share a redacted log snapshot when reporting issues."
          />

          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <button
              onClick={() => void handleCopyDiagnostics()}
              style={{
                padding: "8px 16px",
                background: diagCopied ? `${t.accent}1a` : t.surface,
                border: `0.5px solid ${diagCopied ? t.accent : t.border}`,
                borderRadius: 7,
                fontFamily: SANS,
                fontSize: 13,
                color: diagCopied ? t.accent : t.textDim,
                cursor: "pointer",
                transition: "color .15s, border-color .15s, background .15s",
              }}
            >
              {diagCopied ? "Copied!" : "Copy diagnostics"}
            </button>
            <span
              style={{
                fontFamily: SANS,
                fontSize: 12,
                color: t.textFaint,
                lineHeight: 1.5,
              }}
            >
              Copies the application log to your clipboard. Tokens and secrets are redacted
              automatically.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
