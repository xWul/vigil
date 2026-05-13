import { useState, useEffect, useMemo, useCallback } from "react";

import type {
  Diff,
  FileDiff,
  Hunk,
  NewReview,
  PullRequest,
  ReviewVerdict,
} from "../../../shared/model/index.js";
import type { Finding, FindingPass } from "../../../shared/review.js";
import { api } from "../../api.js";
import { TOKENS, SANS, MONO } from "../../shared/theme.js";

// ── Local types ───────────────────────────────────────────────────────────────

type PassPhase = { phase: "running" } | { phase: "done"; count: number };
type PassMap = Partial<Record<FindingPass, PassPhase>>;

interface QueuedComment {
  finding: Finding;
  body: string;
}

interface Draft {
  verdict: ReviewVerdict | null;
  body: string;
  comments: readonly QueuedComment[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function lineId(file: string, line: number): string {
  return `dl-${file.replace(/[^a-zA-Z0-9]/g, "_")}-${line}`;
}

function severityColor(s: Finding["severity"]): string {
  const t = TOKENS.dark;
  if (s === "critical" || s === "high") return t.red;
  if (s === "medium") return t.amber;
  return t.green;
}

function passLabel(pass: FindingPass): string {
  const labels: Record<FindingPass, string> = {
    correctness: "Correctness",
    security: "Security",
    consistency: "Consistency",
    complexity: "Complexity",
    duplication: "Duplication",
    smells: "Smells",
    "debug-artifacts": "Debug",
    "type-safety": "Types",
    "change-classification": "Change",
    regression: "Regression",
  };
  return labels[pass];
}

function fallbackRiskScore(findings: readonly Finding[]): 1 | 2 | 3 | 4 | 5 {
  if (findings.some((f) => f.severity === "critical")) return 5;
  if (findings.some((f) => f.severity === "high")) return 4;
  if (findings.some((f) => f.severity === "medium")) return 3;
  if (findings.some((f) => f.severity === "low")) return 2;
  return 1;
}

function formatFindingComment(f: Finding): string {
  return `**[${f.severity.toUpperCase()}] ${f.title}**\n\n${f.description}${f.evidence ? `\n\n\`\`\`\n${f.evidence}\n\`\`\`` : ""}`;
}
// ── SeverityBadge ─────────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: Finding["severity"] }) {
  const color = severityColor(severity);
  return (
    <span
      style={{
        fontFamily: SANS,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.07em",
        textTransform: "uppercase" as const,
        color,
        background: `${color}22`,
        border: `1px solid ${color}44`,
        borderRadius: 4,
        padding: "2px 6px",
        whiteSpace: "nowrap" as const,
      }}
    >
      {severity}
    </span>
  );
}

// ── FindingDot ────────────────────────────────────────────────────────────────

function FindingDot({
  findings,
  focused,
  onClick,
}: {
  findings: Finding[];
  focused: boolean;
  onClick: () => void;
}) {
  const top = findings[0];
  if (!top) return <div style={{ width: 16 }} />;
  const color = severityColor(top.severity);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={`${findings.length} finding${findings.length > 1 ? "s" : ""}: ${top.title}`}
      style={{
        width: 16,
        height: 16,
        borderRadius: "50%",
        background: focused ? color : `${color}66`,
        border: `2px solid ${focused ? color : `${color}88`}`,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        flexShrink: 0,
        transition: "background 120ms, border-color 120ms",
        position: "relative" as const,
      }}
    >
      {findings.length > 1 && (
        <span
          style={{
            position: "absolute" as const,
            top: -5,
            right: -5,
            background: color,
            color: "#fff",
            fontSize: 8,
            fontFamily: MONO,
            fontWeight: 700,
            borderRadius: 6,
            padding: "0 3px",
            lineHeight: "12px",
            minWidth: 12,
            textAlign: "center" as const,
          }}
        >
          {findings.length}
        </span>
      )}
    </button>
  );
}

// ── PassStrip ─────────────────────────────────────────────────────────────────

function PassStrip({ passes, visible }: { passes: PassMap; visible: boolean }) {
  const t = TOKENS.dark;
  const entries = Object.entries(passes) as [FindingPass, PassPhase][];
  if (!visible || entries.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 16px",
        borderTop: `1px solid ${t.border}`,
        background: t.bg,
        flexShrink: 0,
        flexWrap: "wrap" as const,
      }}
    >
      <span style={{ fontFamily: SANS, fontSize: 11, color: t.textFaint, marginRight: 2 }}>
        Analysis:
      </span>
      {entries.map(([pass, state]) => (
        <span
          key={pass}
          style={{
            fontFamily: MONO,
            fontSize: 11,
            color: state.phase === "done" ? t.textDim : t.accent,
            background: state.phase === "done" ? t.surface : `${t.accent}18`,
            border: `1px solid ${state.phase === "done" ? t.border : `${t.accent}44`}`,
            borderRadius: 4,
            padding: "2px 7px",
            whiteSpace: "nowrap" as const,
          }}
        >
          {state.phase === "running" ? "⟳ " : "✓ "}
          {passLabel(pass)}
          {state.phase === "done" && state.count > 0 ? ` · ${state.count}` : ""}
        </span>
      ))}
    </div>
  );
}

// ── DiffView ──────────────────────────────────────────────────────────────────

function HunkView({
  hunk,
  file,
  findingMap,
  focusedFinding,
  onSelectFinding,
}: {
  hunk: Hunk;
  file: FileDiff;
  findingMap: Map<string, Finding[]>;
  focusedFinding: Finding | null;
  onSelectFinding: (f: Finding) => void;
}) {
  const t = TOKENS.dark;
  const header = `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`;

  return (
    <div style={{ marginBottom: 1 }}>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 11,
          color: t.textFaint,
          background: `${t.accent}0f`,
          padding: "3px 12px",
          borderTop: `1px solid ${t.border}`,
          borderBottom: `1px solid ${t.border}`,
          userSelect: "none" as const,
        }}
      >
        {header}
      </div>
      {hunk.lines.map((line, i) => {
        const lineFindings =
          line.newLine !== null ? (findingMap.get(`${file.newPath}:${line.newLine}`) ?? []) : [];
        const isFocused = focusedFinding !== null && lineFindings.includes(focusedFinding);
        const isAdded = line.kind === "added";
        const isRemoved = line.kind === "removed";

        const bgColor = isFocused
          ? `${severityColor(focusedFinding.severity)}22`
          : isAdded
            ? "rgba(46,160,67,0.10)"
            : isRemoved
              ? "rgba(248,81,73,0.10)"
              : "transparent";

        const prefixColor = isAdded ? t.green : isRemoved ? t.red : t.textFaint;
        const prefix = isAdded ? "+" : isRemoved ? "-" : " ";

        const id = line.newLine !== null ? lineId(file.newPath, line.newLine) : undefined;

        return (
          <div
            key={i}
            id={id}
            style={{
              display: "flex",
              alignItems: "center",
              background: bgColor,
              minHeight: 20,
              transition: "background 120ms",
            }}
          >
            {/* Old line number */}
            <div
              style={{
                width: 40,
                textAlign: "right" as const,
                fontFamily: MONO,
                fontSize: 11,
                color: t.textFaint,
                padding: "1px 8px 1px 0",
                flexShrink: 0,
                userSelect: "none" as const,
                opacity: isAdded ? 0 : 1,
              }}
            >
              {line.oldLine ?? ""}
            </div>
            {/* New line number */}
            <div
              style={{
                width: 40,
                textAlign: "right" as const,
                fontFamily: MONO,
                fontSize: 11,
                color: t.textFaint,
                padding: "1px 8px 1px 0",
                flexShrink: 0,
                userSelect: "none" as const,
                opacity: isRemoved ? 0 : 1,
              }}
            >
              {line.newLine ?? ""}
            </div>
            {/* Finding dot */}
            <div
              style={{
                width: 20,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {lineFindings.length > 0 && (
                <FindingDot
                  findings={lineFindings}
                  focused={isFocused}
                  onClick={() => onSelectFinding(lineFindings[0]!)}
                />
              )}
            </div>
            {/* Prefix + content */}
            <div
              style={{
                fontFamily: MONO,
                fontSize: 12,
                lineHeight: "20px",
                color: isAdded ? t.text : isRemoved ? t.textDim : t.textDim,
                padding: "0 12px 0 4px",
                whiteSpace: "pre" as const,
                overflow: "hidden",
              }}
            >
              <span style={{ color: prefixColor, userSelect: "none" as const }}>{prefix}</span>
              {line.content}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FileView({
  file,
  findingMap,
  focusedFinding,
  onSelectFinding,
}: {
  file: FileDiff;
  findingMap: Map<string, Finding[]>;
  focusedFinding: Finding | null;
  onSelectFinding: (f: Finding) => void;
}) {
  const t = TOKENS.dark;
  const [collapsed, setCollapsed] = useState(false);

  const statusColor =
    file.status === "added" ? t.green : file.status === "deleted" ? t.red : t.amber;
  const statusLabel =
    file.status === "added"
      ? "A"
      : file.status === "deleted"
        ? "D"
        : file.status === "renamed"
          ? "R"
          : "M";

  return (
    <div style={{ marginBottom: 8 }}>
      <button
        onClick={() => setCollapsed((c) => !c)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          background: t.surface,
          border: "none",
          borderTop: `1px solid ${t.border}`,
          borderBottom: collapsed ? `1px solid ${t.border}` : "none",
          padding: "6px 12px",
          cursor: "pointer",
          textAlign: "left" as const,
        }}
      >
        <span
          style={{
            fontFamily: MONO,
            fontSize: 10,
            fontWeight: 700,
            color: statusColor,
            background: `${statusColor}22`,
            borderRadius: 3,
            padding: "1px 4px",
            flexShrink: 0,
          }}
        >
          {statusLabel}
        </span>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 12,
            color: t.text,
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap" as const,
          }}
        >
          {file.newPath}
          {file.status === "renamed" && file.oldPath && (
            <span style={{ color: t.textFaint }}> ← {file.oldPath}</span>
          )}
        </span>
        <span style={{ color: t.textFaint, fontSize: 11, fontFamily: SANS, flexShrink: 0 }}>
          {collapsed ? "▶" : "▼"}
        </span>
      </button>
      {!collapsed &&
        file.hunks.map((hunk, i) => (
          <HunkView
            key={i}
            hunk={hunk}
            file={file}
            findingMap={findingMap}
            focusedFinding={focusedFinding}
            onSelectFinding={onSelectFinding}
          />
        ))}
    </div>
  );
}

// ── FindingList ───────────────────────────────────────────────────────────────

function FindingList({
  findings,
  selectedIdx,
  reviewDone,
  onSelect,
}: {
  findings: readonly Finding[];
  selectedIdx: number | null;
  reviewDone: boolean;
  onSelect: (f: Finding) => void;
}) {
  const t = TOKENS.dark;

  if (!reviewDone && findings.length === 0) {
    return (
      <div style={{ padding: "24px 16px", fontFamily: SANS, fontSize: 12, color: t.textFaint }}>
        Review running…
      </div>
    );
  }

  if (reviewDone && findings.length === 0) {
    return (
      <div style={{ padding: "24px 16px", fontFamily: SANS, fontSize: 12, color: t.textFaint }}>
        No findings — this PR looks clean.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", flex: 1 }}>
      <div
        style={{
          padding: "10px 16px 8px",
          fontFamily: SANS,
          fontSize: 11,
          color: t.textFaint,
          borderBottom: `1px solid ${t.border}`,
          flexShrink: 0,
        }}
      >
        {findings.length} finding{findings.length !== 1 ? "s" : ""} · j/k to navigate · Enter to open
      </div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {findings.map((f, i) => {
          const isSelected = i === selectedIdx;
          const color = severityColor(f.severity);
          const file = f.file ? f.file.split("/").pop() ?? f.file : "";
          const loc = f.lines ? `:${f.lines.start}` : "";
          return (
            <div
              key={i}
              onClick={() => onSelect(f)}
              style={{
                padding: "8px 16px",
                cursor: "pointer",
                background: isSelected ? t.selected : "transparent",
                borderLeft: `2px solid ${isSelected ? color : "transparent"}`,
                borderBottom: `1px solid ${t.border}`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 3,
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: color,
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontFamily: MONO, fontSize: 10, color: t.textFaint }}>
                  {passLabel(f.pass)}
                </span>
                {file && (
                  <span style={{ fontFamily: MONO, fontSize: 10, color: t.textFaint, marginLeft: "auto" }}>
                    {file}{loc}
                  </span>
                )}
              </div>
              <div
                style={{
                  fontFamily: SANS,
                  fontSize: 12,
                  color: isSelected ? t.text : t.textDim,
                  lineHeight: 1.3,
                  paddingLeft: 13,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap" as const,
                }}
              >
                {f.title}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Right panel ───────────────────────────────────────────────────────────────

function FindingDetail({
  finding,
  hasAI,
  onAddToReview,
}: {
  finding: Finding;
  hasAI: boolean;
  onAddToReview: (f: Finding) => void;
}) {
  const t = TOKENS.dark;
  return (
    <div style={{ padding: "16px 16px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <SeverityBadge severity={finding.severity} />
        <span style={{ fontFamily: MONO, fontSize: 11, color: t.textFaint }}>
          {passLabel(finding.pass)}
        </span>
      </div>
      <div
        style={{
          fontFamily: SANS,
          fontSize: 13,
          fontWeight: 600,
          color: t.text,
          lineHeight: 1.4,
          marginBottom: 8,
        }}
      >
        {finding.title}
      </div>
      <div
        style={{
          fontFamily: SANS,
          fontSize: 12,
          color: t.textDim,
          lineHeight: 1.6,
          marginBottom: 12,
        }}
      >
        {finding.description}
      </div>
      {finding.evidence && (
        <pre
          style={{
            fontFamily: MONO,
            fontSize: 11,
            color: t.textDim,
            background: t.surface,
            border: `1px solid ${t.border}`,
            borderRadius: 6,
            padding: "8px 10px",
            overflow: "auto",
            whiteSpace: "pre-wrap" as const,
            wordBreak: "break-all" as const,
            marginBottom: 12,
            margin: "0 0 12px",
          }}
        >
          {finding.evidence}
        </pre>
      )}
      <button
        onClick={() => onAddToReview(finding)}
        style={{
          fontFamily: SANS,
          fontSize: 12,
          fontWeight: 500,
          color: t.text,
          background: t.surface,
          border: `1px solid ${t.border}`,
          borderRadius: 6,
          padding: "6px 12px",
          cursor: "pointer",
          width: "100%",
          textAlign: "center" as const,
          marginBottom: 12,
        }}
      >
        + Add to review
      </button>
      <div
        style={{
          fontFamily: SANS,
          fontSize: 11,
          color: t.textFaint,
          textAlign: "center" as const,
          marginBottom: 16,
        }}
      >
        {hasAI ? "Challenge this · coming soon" : "Configure AI in Settings to challenge findings"}
      </div>
      <div style={{ height: 1, background: t.border, margin: "0 -16px" }} />
    </div>
  );
}

function ReviewDraftPanel({
  draft,
  prUrl,
  onChange,
  onSubmit,
  submitting,
  submitted,
}: {
  draft: Draft;
  prUrl: string;
  onChange: (d: Partial<Draft>) => void;
  onSubmit: () => void;
  submitting: boolean;
  submitted: boolean;
}) {
  const t = TOKENS.dark;

  if (submitted) {
    return (
      <div style={{ padding: 16 }}>
        <div
          style={{
            fontFamily: SANS,
            fontSize: 13,
            color: t.green,
            fontWeight: 500,
            marginBottom: 8,
          }}
        >
          Review submitted
        </div>
        <a
          href={prUrl}
          style={{ fontFamily: MONO, fontSize: 11, color: t.accent }}
          onClick={(e) => {
            e.preventDefault();
            window.open(prUrl, "_blank");
          }}
        >
          View on platform →
        </a>
      </div>
    );
  }

  const verdictBtn = (v: ReviewVerdict, label: string, color: string) => {
    const active = draft.verdict === v;
    return (
      <button
        onClick={() => onChange({ verdict: active ? null : v })}
        style={{
          flex: 1,
          fontFamily: SANS,
          fontSize: 11,
          fontWeight: active ? 600 : 400,
          color: active ? color : t.textDim,
          background: active ? `${color}18` : "none",
          border: `1px solid ${active ? `${color}66` : t.border}`,
          borderRadius: 6,
          padding: "5px 0",
          cursor: "pointer",
          transition: "all 120ms",
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div style={{ padding: 16 }}>
      <div
        style={{
          fontFamily: SANS,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase" as const,
          color: t.textFaint,
          marginBottom: 10,
        }}
      >
        Review
      </div>

      {draft.comments.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          {draft.comments.map((c, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                padding: "6px 8px",
                background: t.surface,
                borderRadius: 6,
                marginBottom: 4,
              }}
            >
              <SeverityBadge severity={c.finding.severity} />
              <span
                style={{
                  flex: 1,
                  fontFamily: SANS,
                  fontSize: 11,
                  color: t.textDim,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap" as const,
                }}
              >
                {c.finding.title}
              </span>
              <button
                onClick={() => onChange({ comments: draft.comments.filter((_, j) => j !== i) })}
                style={{
                  background: "none",
                  border: "none",
                  color: t.textFaint,
                  cursor: "pointer",
                  padding: 0,
                  fontSize: 12,
                  lineHeight: 1,
                  flexShrink: 0,
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <textarea
        value={draft.body}
        onChange={(e) => onChange({ body: e.target.value })}
        placeholder="Leave a comment…"
        rows={3}
        style={{
          width: "100%",
          fontFamily: SANS,
          fontSize: 12,
          color: t.text,
          background: t.surface,
          border: `1px solid ${t.border}`,
          borderRadius: 6,
          padding: "7px 9px",
          resize: "vertical" as const,
          outline: "none",
          marginBottom: 8,
          boxSizing: "border-box" as const,
        }}
      />

      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        {verdictBtn("approved", "Approve", t.green)}
        {verdictBtn("changes_requested", "Request changes", t.red)}
        {verdictBtn("commented", "Comment", t.textDim)}
      </div>

      <button
        onClick={onSubmit}
        disabled={submitting || (!draft.body && draft.comments.length === 0 && !draft.verdict)}
        style={{
          width: "100%",
          fontFamily: SANS,
          fontSize: 13,
          fontWeight: 500,
          color:
            submitting || (!draft.body && draft.comments.length === 0 && !draft.verdict)
              ? t.textFaint
              : t.bg,
          background:
            submitting || (!draft.body && draft.comments.length === 0 && !draft.verdict)
              ? t.surface
              : t.accent,
          border: "none",
          borderRadius: 8,
          padding: "9px 0",
          cursor:
            submitting || (!draft.body && draft.comments.length === 0 && !draft.verdict)
              ? "default"
              : "pointer",
          transition: "background 150ms, color 150ms",
        }}
      >
        {submitting ? "Submitting…" : "Submit review"}
      </button>
    </div>
  );
}

// ── WorkspaceScreen ───────────────────────────────────────────────────────────

export function WorkspaceScreen({ pr, onBack }: { pr: PullRequest; onBack: () => void }) {
  const t = TOKENS.dark;

  const [diff, setDiff] = useState<Diff | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [passes, setPasses] = useState<PassMap>({});
  const [reviewDone, setReviewDone] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>({ verdict: null, body: "", comments: [] });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [hasAI, setHasAI] = useState(false); // used for challenge thread gating

  // Findings that have line positions — navigation targets
  const sortedFindings = useMemo(
    () =>
      findings
        .filter((f) => f.lines !== null)
        .sort((a, b) => {
          const fc = a.file.localeCompare(b.file);
          if (fc !== 0) return fc;
          return (a.lines?.start ?? 0) - (b.lines?.start ?? 0);
        }),
    [findings],
  );


  const focusedFinding = selectedIdx !== null ? (sortedFindings[selectedIdx] ?? null) : null;

  // Map from "file:line" → Finding[] for gutter dots
  const findingMap = useMemo(() => {
    const map = new Map<string, Finding[]>();
    for (const f of findings) {
      if (!f.lines) continue;
      for (let ln = f.lines.start; ln <= f.lines.end; ln++) {
        const key = `${f.file}:${ln}`;
        const arr = map.get(key) ?? [];
        arr.push(f);
        map.set(key, arr);
      }
    }
    return map;
  }, [findings]);

  // Scroll diff to focused finding
  useEffect(() => {
    if (!focusedFinding?.lines) return;
    const id = lineId(focusedFinding.file, focusedFinding.lines.start);
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusedFinding]);

  // Load diff + check settings + start review
  useEffect(() => {
    let mounted = true;

    async function init() {
      const [diffResult, settingsResult] = await Promise.all([
        api.invoke("platform:getPRWithDiff", pr.ref),
        api.invoke("settings:get"),
      ]);

      if (!mounted) return;

      if (!diffResult.ok) {
        setLoadError(diffResult.error.code);
        return;
      }
      setDiff(diffResult.value.diff);

      if (settingsResult.ok) {
        setHasAI(
          (settingsResult.value.aiProvider === "anthropic" &&
            settingsResult.value.hasAnthropicKey) ||
            (settingsResult.value.aiProvider === "openai" && settingsResult.value.hasOpenAIKey),
        );
      }

      // Cache-first
      const cached = await api.invoke("review:getCached", pr.ref, pr.headSha);
      if (!mounted) return;

      if (cached.ok && cached.value) {
        setFindings([...cached.value.findings]);
        setReviewDone(true);
        return;
      }

      // Auto-run
      const result = await api.invoke("review:run", pr.ref);
      if (!mounted) return;
      if (result.ok) setFindings([...result.value.findings]);
      setReviewDone(true);
    }

    void init();
    return () => {
      mounted = false;
    };
  }, [pr]);

  // Stream findings and pass updates
  useEffect(() => {
    const offFinding = api.on("review:finding", ({ finding }) => {
      setFindings((prev) => {
        if (prev.some((f) => f.title === finding.title && f.file === finding.file)) return prev;
        return [...prev, finding];
      });
    });

    const offPass = api.on("review:pass", ({ pass, status, count }) => {
      setPasses((prev) => ({
        ...prev,
        [pass]: status === "start" ? { phase: "running" } : { phase: "done", count },
      }));
    });

    return () => {
      offFinding();
      offPass();
    };
  }, []);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const inField =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (inField) return;

      if (e.key === "Escape") {
        if (selectedIdx !== null) {
          setSelectedIdx(null);
        } else {
          onBack();
        }
        return;
      }
      if (e.key === "Enter" && selectedIdx === null && sortedFindings.length > 0) {
        setSelectedIdx(0);
        return;
      }
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => (i === null ? 0 : Math.min(sortedFindings.length - 1, i + 1)));
      }
      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => (i === null ? 0 : Math.max(0, i - 1)));
      }
      if (e.key === "a" && focusedFinding) {
        handleAddToReview(focusedFinding);
      }
    },
    [sortedFindings.length, selectedIdx, focusedFinding, onBack],
  );

  function handleAddToReview(f: Finding) {
    setDraft((d) => {
      if (d.comments.some((c) => c.finding === f)) return d;
      return { ...d, comments: [...d.comments, { finding: f, body: formatFindingComment(f) }] };
    });
  }

  function handleSelectFinding(f: Finding) {
    const idx = sortedFindings.indexOf(f);
    setSelectedIdx(idx >= 0 ? idx : null);
  }

  async function handleSubmit() {
    if (!diff) return;
    setSubmitting(true);
    const review: NewReview = {
      verdict: draft.verdict ?? "commented",
      body: draft.body,
      comments: draft.comments.map((c) =>
        c.finding.lines
          ? {
              kind: "inline" as const,
              body: c.body,
              path: c.finding.file,
              line: c.finding.lines.start,
            }
          : { kind: "pr_comment" as const, body: c.body },
      ),
    };
    const result = await api.invoke("platform:submitReview", pr.ref, review);
    if (result.ok) setSubmitted(true);
    setSubmitting(false);
  }

  const riskScore = findings.length > 0 ? fallbackRiskScore(findings) : null;
  const riskColor =
    riskScore !== null && riskScore >= 4 ? t.red : riskScore === 3 ? t.amber : t.green;

  return (
    <div
      tabIndex={0}
      onKeyDown={handleKeyDown}
      style={{
        width: "100%",
        height: "100%",
        background: t.bg,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        outline: "none",
      }}
    >
      {/* Titlebar */}
      <div
        style={
          {
            height: 48,
            display: "flex",
            alignItems: "center",
            padding: "0 16px",
            gap: 12,
            borderBottom: `1px solid ${t.border}`,
            flexShrink: 0,
            WebkitAppRegion: "drag",
          } as React.CSSProperties
        }
      >
        <div
          style={
            {
              WebkitAppRegion: "no-drag",
              display: "flex",
              alignItems: "center",
              gap: 12,
            } as React.CSSProperties
          }
        >
          <button
            onClick={onBack}
            style={{
              fontFamily: SANS,
              fontSize: 12,
              color: t.textDim,
              background: "none",
              border: "none",
              padding: "3px 0",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <span style={{ fontSize: 14, lineHeight: 1 }}>←</span>
            Queue
          </button>
        </div>
        <div style={{ flex: 1, minWidth: 0, WebkitAppRegion: "drag" } as React.CSSProperties}>
          <div
            style={{
              fontFamily: SANS,
              fontSize: 13,
              fontWeight: 500,
              color: t.text,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {pr.title}
          </div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: t.textFaint, marginTop: 1 }}>
            {pr.author.login} · {pr.sourceBranch} → {pr.targetBranch}
          </div>
        </div>
        {riskScore !== null && (
          <div
            style={
              {
                WebkitAppRegion: "no-drag",
                fontFamily: MONO,
                fontSize: 11,
                fontWeight: 700,
                color: riskColor,
                background: `${riskColor}18`,
                border: `1px solid ${riskColor}44`,
                borderRadius: 4,
                padding: "3px 8px",
                flexShrink: 0,
              } as React.CSSProperties
            }
          >
            Risk {riskScore}/5
          </div>
        )}
        {findings.length > 0 && (
          <div
            style={
              {
                WebkitAppRegion: "no-drag",
                fontFamily: SANS,
                fontSize: 11,
                color: t.textFaint,
                flexShrink: 0,
              } as React.CSSProperties
            }
          >
            {findings.length} finding{findings.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left: diff */}
        <div
          style={{
            flex: "0 0 65%",
            display: "flex",
            flexDirection: "column",
            borderRight: `1px solid ${t.border}`,
            overflow: "hidden",
          }}
        >
          <div style={{ flex: 1, overflowY: "auto", overflowX: "auto" }}>
            {loadError ? (
              <div
                style={{
                  padding: 32,
                  fontFamily: SANS,
                  fontSize: 13,
                  color: t.red,
                }}
              >
                Failed to load diff: {loadError}
              </div>
            ) : !diff ? (
              <div
                style={{
                  padding: 32,
                  fontFamily: SANS,
                  fontSize: 13,
                  color: t.textFaint,
                }}
              >
                Loading diff…
              </div>
            ) : diff.files.length === 0 ? (
              <div
                style={{
                  padding: 32,
                  fontFamily: SANS,
                  fontSize: 13,
                  color: t.textFaint,
                }}
              >
                No changes in this PR.
              </div>
            ) : (
              diff.files.map((file, i) => (
                <FileView
                  key={i}
                  file={file}
                  findingMap={findingMap}
                  focusedFinding={focusedFinding}
                  onSelectFinding={handleSelectFinding}
                />
              ))
            )}
          </div>
          <PassStrip passes={passes} visible={!reviewDone || Object.keys(passes).length > 0} />
        </div>

        {/* Right: panel */}
        <div
          style={{
            flex: "0 0 35%",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            borderLeft: `1px solid ${t.border}`,
          }}
        >
          {focusedFinding ? (
            <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", flex: 1 }}>
              <button
                onClick={() => setSelectedIdx(null)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 16px",
                  background: "transparent",
                  border: "none",
                  borderBottom: `1px solid ${t.border}`,
                  cursor: "pointer",
                  fontFamily: SANS,
                  fontSize: 11,
                  color: t.textFaint,
                  textAlign: "left" as const,
                  flexShrink: 0,
                }}
              >
                ← All findings
              </button>
              <div style={{ overflowY: "auto", flex: 1 }}>
                <FindingDetail
                  finding={focusedFinding}
                  hasAI={hasAI}
                  onAddToReview={handleAddToReview}
                />
              </div>
            </div>
          ) : (
            <FindingList
              findings={sortedFindings}
              selectedIdx={selectedIdx}
              reviewDone={reviewDone}
              onSelect={handleSelectFinding}
            />
          )}

          <div style={{ height: 1, background: t.border }} />

          <ReviewDraftPanel
            draft={draft}
            prUrl={pr.url}
            onChange={(d) => setDraft((prev) => ({ ...prev, ...d }))}
            onSubmit={() => void handleSubmit()}
            submitting={submitting}
            submitted={submitted}
          />
        </div>
      </div>
    </div>
  );
}
