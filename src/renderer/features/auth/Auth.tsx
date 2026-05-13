import { useState, useRef } from "react";

import type { ConnectedAccount } from "../../../shared/auth.js";
import { api } from "../../api.js";
import { TOKENS, SANS, MONO } from "../../shared/theme.js";

// ── Types ────────────────────────────────────────────────────────────────────

type Platform = "github" | "azure-devops";

type SignInState =
  | { status: "idle" }
  | { status: "browser"; platform: Platform }
  | { status: "pat"; platform: Platform }
  | { status: "error"; platform: Platform; message: string };

// ── Icons ─────────────────────────────────────────────────────────────────────

function GitHubIcon({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill={color}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function AzureIcon({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M9.16 1L5.12 5.34 1 12.16h3.56L9.16 1zM9.88 2.04l-2.2 5.88 3.84 4.32-7.04 1.72H15L9.88 2.04z"
        fill={color}
      />
    </svg>
  );
}

// ── Platform button ───────────────────────────────────────────────────────────

function PlatformButton({
  platform,
  busy,
  onClick,
}: {
  platform: Platform;
  busy: boolean;
  onClick: () => void;
}) {
  const t = TOKENS.dark;
  const isGitHub = platform === "github";
  const label = isGitHub ? "Sign in with GitHub" : "Sign in with Azure DevOps";
  const icon = isGitHub ? <GitHubIcon color={t.text} /> : <AzureIcon color={t.text} />;

  return (
    <button
      onClick={onClick}
      disabled={busy}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        width: "100%",
        padding: "11px 16px",
        borderRadius: 9,
        border: `0.5px solid ${t.border}`,
        background: busy ? t.surface : t.selected,
        color: busy ? t.textDim : t.text,
        fontFamily: SANS,
        fontSize: 14,
        fontWeight: 450,
        letterSpacing: "-0.005em",
        cursor: busy ? "not-allowed" : "pointer",
        transition: "background .08s linear",
      }}
    >
      {icon}
      {label}
    </button>
  );
}

// ── PAT field ────────────────────────────────────────────────────────────────

function PATField({
  platform,
  onSubmit,
  onCancel,
  busy,
}: {
  platform: Platform;
  onSubmit: (token: string) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const t = TOKENS.dark;
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const platformLabel = platform === "github" ? "GitHub" : "Azure DevOps";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "12px 14px",
        borderRadius: 9,
        border: `0.5px solid ${t.border}`,
        background: t.surface,
      }}
    >
      <div style={{ fontFamily: SANS, fontSize: 12.5, color: t.textDim }}>
        Paste your {platformLabel} personal access token
      </div>
      <input
        ref={inputRef}
        type="password"
        placeholder="ghp_… or a PAT"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim()) onSubmit(value.trim());
          if (e.key === "Escape") onCancel();
        }}
        autoFocus
        disabled={busy}
        style={{
          background: "transparent",
          border: 0,
          borderBottom: `0.5px solid ${t.border}`,
          color: t.text,
          fontFamily: MONO,
          fontSize: 13,
          padding: "4px 0 6px",
          width: "100%",
          outline: "none",
        }}
      />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          onClick={onCancel}
          style={{
            padding: "5px 12px",
            borderRadius: 6,
            border: 0,
            background: "transparent",
            color: t.textDim,
            fontFamily: SANS,
            fontSize: 12.5,
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
        <button
          onClick={() => value.trim() && onSubmit(value.trim())}
          disabled={!value.trim() || busy}
          style={{
            padding: "5px 12px",
            borderRadius: 6,
            border: 0,
            background: value.trim() && !busy ? t.accent : t.border,
            color: value.trim() && !busy ? t.bg : t.textFaint,
            fontFamily: SANS,
            fontSize: 12.5,
            fontWeight: 500,
            cursor: value.trim() && !busy ? "pointer" : "not-allowed",
            transition: "background .08s linear",
          }}
        >
          Connect
        </button>
      </div>
    </div>
  );
}

// ── Auth row (button + PAT toggle) ───────────────────────────────────────────

function AuthRow({
  platform,
  state,
  onOAuth,
  onPATOpen,
  onPATSubmit,
  onPATCancel,
}: {
  platform: Platform;
  state: SignInState;
  onOAuth: () => void;
  onPATOpen: () => void;
  onPATSubmit: (token: string) => void;
  onPATCancel: () => void;
}) {
  const t = TOKENS.dark;
  const busy =
    state.status === "browser" || (state.status === "pat" && state.platform === platform);
  const patOpen = state.status === "pat" && state.platform === platform;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <PlatformButton platform={platform} busy={busy} onClick={onOAuth} />

      {patOpen ? (
        <PATField platform={platform} onSubmit={onPATSubmit} onCancel={onPATCancel} busy={busy} />
      ) : (
        <button
          onClick={onPATOpen}
          disabled={busy}
          style={{
            alignSelf: "center",
            background: "transparent",
            border: 0,
            color: t.textFaint,
            fontFamily: SANS,
            fontSize: 12,
            cursor: busy ? "not-allowed" : "pointer",
            padding: "2px 8px",
          }}
        >
          Use a personal access token instead
        </button>
      )}
    </div>
  );
}

// ── Busy overlay (browser flow in progress) ──────────────────────────────────

function BusyBanner({ platform }: { platform: Platform }) {
  const t = TOKENS.dark;
  const label =
    platform === "github"
      ? "Check your browser — enter the code shown to continue."
      : "Completing sign-in in your browser…";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        borderRadius: 8,
        background: t.surface,
        border: `0.5px solid ${t.border}`,
      }}
    >
      <Spinner color={t.accent} />
      <span style={{ fontFamily: SANS, fontSize: 13, color: t.textDim }}>{label}</span>
    </div>
  );
}

function Spinner({ color }: { color: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      style={{ animation: "vigil-spin 0.8s linear infinite", flexShrink: 0 }}
    >
      <circle cx="7" cy="7" r="5.5" stroke={color} strokeWidth="1.5" strokeOpacity="0.25" />
      <path
        d="M7 1.5A5.5 5.5 0 0 1 12.5 7"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export function Auth({
  onAuthenticated,
}: {
  onAuthenticated: (accounts: readonly ConnectedAccount[]) => void;
}) {
  const t = TOKENS.dark;
  const [state, setState] = useState<SignInState>({ status: "idle" });

  async function signInOAuth(platform: Platform) {
    setState({ status: "browser", platform });
    const result = await api.invoke("auth:signIn", platform);
    if (!result.ok) {
      setState({
        status: "error",
        platform,
        message:
          result.error.code === "cancelled"
            ? "Sign-in cancelled."
            : `Sign-in failed: ${result.error.code}`,
      });
      return;
    }
    const accounts = await api.invoke("auth:getAccounts");
    onAuthenticated(accounts.ok ? accounts.value : [result.value]);
  }

  async function signInPAT(platform: Platform, token: string) {
    setState({ status: "pat", platform });
    const result = await api.invoke("auth:signInWithPAT", platform, token);
    if (!result.ok) {
      setState({
        status: "error",
        platform,
        message: `Sign-in failed: ${result.error.code}`,
      });
      return;
    }
    const accounts = await api.invoke("auth:getAccounts");
    onAuthenticated(accounts.ok ? accounts.value : [result.value]);
  }

  const isBusy = state.status === "browser" || state.status === "pat";
  const errorMessage = state.status === "error" ? state.message : null;

  return (
    <div
      style={
        {
          width: "100%",
          height: "100%",
          background: t.bg,
          color: t.text,
          display: "flex",
          flexDirection: "column",
          position: "relative",
          // CSS vars for any utility classes
          "--v-bg": t.bg,
          "--v-surface": t.surface,
          "--v-selected": t.selected,
          "--v-border": t.border,
          "--v-text": t.text,
          "--v-text-dim": t.textDim,
          "--v-text-faint": t.textFaint,
          "--v-accent": t.accent,
          "--v-accent-dim": t.accentDim,
          "--v-kbd-bg": t.kbdBg,
          "--v-kbd-border": t.kbdBorder,
        } as React.CSSProperties
      }
    >
      {/* Titlebar */}

      {/* Centered card */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 40px 60px",
        }}
      >
        <div style={{ width: "100%", maxWidth: 360 }}>
          {/* Wordmark */}
          <div
            style={{
              fontFamily: SANS,
              fontSize: 22,
              fontWeight: 500,
              letterSpacing: "-0.02em",
              color: t.text,
              marginBottom: 6,
            }}
          >
            Vigil
          </div>
          <div
            style={{
              fontFamily: SANS,
              fontSize: 13.5,
              color: t.textDim,
              marginBottom: 36,
              lineHeight: 1.5,
            }}
          >
            Connect a platform to start reviewing pull requests.
          </div>

          {/* Sign-in options */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* GitHub */}
            <AuthRow
              platform="github"
              state={state}
              onOAuth={() => {
                void signInOAuth("github");
              }}
              onPATOpen={() => setState({ status: "pat", platform: "github" })}
              onPATSubmit={(token) => {
                void signInPAT("github", token);
              }}
              onPATCancel={() => setState({ status: "idle" })}
            />

            {/* Divider */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                color: t.textFaint,
                fontFamily: MONO,
                fontSize: 11,
              }}
            >
              <span style={{ flex: 1, height: "0.5px", background: t.border }} />
              or
              <span style={{ flex: 1, height: "0.5px", background: t.border }} />
            </div>

            {/* Azure DevOps */}
            <AuthRow
              platform="azure-devops"
              state={state}
              onOAuth={() => {
                void signInOAuth("azure-devops");
              }}
              onPATOpen={() => setState({ status: "pat", platform: "azure-devops" })}
              onPATSubmit={(token) => {
                void signInPAT("azure-devops", token);
              }}
              onPATCancel={() => setState({ status: "idle" })}
            />
          </div>

          {/* Browser flow banner */}
          {state.status === "browser" && (
            <div style={{ marginTop: 20 }}>
              <BusyBanner platform={state.platform} />
            </div>
          )}

          {/* Error */}
          {errorMessage && (
            <div
              style={{
                marginTop: 20,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "10px 14px",
                borderRadius: 8,
                background: `${t.red}18`,
                border: `0.5px solid ${t.red}40`,
              }}
            >
              <span style={{ fontFamily: SANS, fontSize: 12.5, color: t.red }}>{errorMessage}</span>
              <button
                onClick={() => setState({ status: "idle" })}
                style={{
                  background: "transparent",
                  border: 0,
                  color: t.textFaint,
                  fontFamily: SANS,
                  fontSize: 12,
                  cursor: "pointer",
                  flexShrink: 0,
                  padding: "2px 6px",
                }}
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Privacy note */}
          {!isBusy && !errorMessage && (
            <div
              style={{
                marginTop: 28,
                fontFamily: MONO,
                fontSize: 11,
                color: t.textFaint,
                textAlign: "center",
                lineHeight: 1.55,
              }}
            >
              Tokens are stored in your OS keychain.
              <br />
              No data leaves your machine.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
