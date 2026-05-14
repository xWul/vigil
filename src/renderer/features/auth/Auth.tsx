import { useState } from "react";

import type { ConnectedAccount } from "../../../shared/auth.js";
import { api } from "../../api.js";
import { TOKENS, SANS, MONO } from "../../shared/theme.js";

type Platform = "github" | "azure-devops";

type SignInState =
  | { status: "idle" }
  | { status: "browser"; platform: Platform }
  | { status: "pat"; platform: Platform }
  | { status: "error"; platform: Platform; message: string };

// ── Brand glyphs ──────────────────────────────────────────────────────────────

function VigilMark({ size = 44, color }: { size?: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="3.2" fill={color} />
      <circle cx="24" cy="24" r="9" stroke={color} strokeWidth="1.4" opacity="0.55" />
      <circle cx="24" cy="24" r="15" stroke={color} strokeWidth="1.2" opacity="0.28" />
      <circle cx="24" cy="24" r="21" stroke={color} strokeWidth="1" opacity="0.12" />
    </svg>
  );
}

function GitHubGlyph({ size = 17, color = "#e8e4dc" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55v-1.93c-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.09-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.78 0c2.21-1.49 3.18-1.18 3.18-1.18.62 1.58.23 2.75.11 3.04.74.8 1.18 1.83 1.18 3.09 0 4.42-2.69 5.39-5.25 5.68.41.35.78 1.05.78 2.12v3.14c0 .3.21.66.79.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}

function AzureDevOpsGlyph({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path
        d="M22.5 6.4v11.7l-4.7 3.9-7.5-2.7v2.6L6.2 17 18 17.9V7.3l4.5-.9zM18 7.3L11 1.5l-3.4 3v3.9L1.5 10.3l2.1 2.7v6L11 22.5v-7.7l7-2.5z"
        fill="rgba(255,255,255,0.9)"
      />
    </svg>
  );
}

// ── Spinner ───────────────────────────────────────────────────────────────────

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

// ── PAT field ─────────────────────────────────────────────────────────────────

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
  const platformLabel = platform === "github" ? "GitHub" : "Azure DevOps";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "12px 14px",
        borderRadius: 8,
        border: `0.5px solid ${t.border}`,
        background: t.surface,
      }}
    >
      <div style={{ fontFamily: SANS, fontSize: 12.5, color: t.textDim }}>
        Paste your {platformLabel} personal access token
      </div>
      <input
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
  const isGitHub = platform === "github";

  const bg = isGitHub
    ? busy
      ? "#151311"
      : "#1a1816"
    : busy
      ? "#005fa8"
      : "#0078d4";

  const borderColor = isGitHub ? "#272320" : "#0078d4";
  const textColor = isGitHub
    ? busy
      ? "rgba(232,228,220,0.5)"
      : "#e8e4dc"
    : busy
      ? "rgba(255,255,255,0.6)"
      : "#fff";

  return (
    <button
      onClick={onClick}
      disabled={busy}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        width: "100%",
        height: 44,
        borderRadius: 8,
        border: `0.5px solid ${borderColor}`,
        background: bg,
        color: textColor,
        fontFamily: SANS,
        fontSize: 14,
        fontWeight: 500,
        letterSpacing: "-0.005em",
        cursor: busy ? "not-allowed" : "pointer",
        transition: "background .12s, border-color .12s",
      }}
    >
      {isGitHub ? (
        <GitHubGlyph size={17} color={textColor} />
      ) : (
        <AzureDevOpsGlyph size={17} />
      )}
      {isGitHub ? "Continue with GitHub" : "Continue with Azure DevOps"}
    </button>
  );
}

// ── Auth row ──────────────────────────────────────────────────────────────────

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
        <PATField
          platform={platform}
          onSubmit={onPATSubmit}
          onCancel={onPATCancel}
          busy={busy}
        />
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

// ── Auth ──────────────────────────────────────────────────────────────────────

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
      style={{
        width: "100%",
        height: "100%",
        background: t.bg,
        backgroundImage: [
          "radial-gradient(circle at 18% 12%, rgba(255,255,255,0.025), transparent 40%)",
          "radial-gradient(circle at 82% 88%, oklch(0.74 0.06 200 / 0.05), transparent 45%)",
        ].join(", "),
        display: "flex",
        flexDirection: "column",
        padding: "40px 48px 28px",
        fontFamily: SANS,
        color: t.text,
      }}
    >
      {/* Wordmark */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <VigilMark size={18} color={t.accent} />
        <span
          style={{
            fontSize: 14,
            fontWeight: 500,
            letterSpacing: "-0.005em",
            color: t.text,
          }}
        >
          Vigil
        </span>
      </div>

      {/* Centered card */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ width: 360, display: "flex", flexDirection: "column" }}>
          <VigilMark size={44} color={t.accent} />

          <h1
            style={{
              margin: "24px 0 8px",
              fontSize: 28,
              fontWeight: 500,
              letterSpacing: "-0.02em",
              lineHeight: 1.15,
              color: t.text,
            }}
          >
            Sign in to Vigil
          </h1>
          <p
            style={{
              margin: "0 0 32px",
              fontSize: 14,
              color: t.textDim,
              lineHeight: 1.55,
              letterSpacing: "-0.005em",
              maxWidth: 320,
            }}
          >
            Quietly review pull requests from GitHub and Azure DevOps in one place.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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

          {state.status === "browser" && (
            <div
              style={{
                marginTop: 16,
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
              <span style={{ fontSize: 13, color: t.textDim }}>
                {state.platform === "github"
                  ? "Check your browser — enter the code shown to continue."
                  : "Completing sign-in in your browser…"}
              </span>
            </div>
          )}

          {errorMessage && (
            <div
              style={{
                marginTop: 16,
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
              <span style={{ fontSize: 12.5, color: t.red }}>{errorMessage}</span>
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

          {!isBusy && !errorMessage && (
            <p
              style={{
                margin: "24px 0 0",
                fontSize: 12,
                color: t.textFaint,
                lineHeight: 1.55,
              }}
            >
              Your tokens are stored in your OS keychain. No data leaves your machine.
            </p>
          )}
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          display: "flex",
          gap: 18,
          fontSize: 11,
          color: t.textFaint,
          fontFamily: MONO,
        }}
      >
        <span>Privacy</span>
        <span>Terms</span>
        <span>Status</span>
      </div>
    </div>
  );
}
