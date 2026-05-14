import { useState, useEffect, useMemo, useCallback, useRef } from "react";

import type {
  Diff,
  FileDiff,
  Hunk,
  DiffLine,
  NewReview,
  PullRequest,
  ReviewVerdict,
} from "../../../shared/model/index.js";
import type { Finding, FindingPass } from "../../../shared/review.js";
import { api } from "../../api.js";
import { TOKENS, SANS, MONO } from "../../shared/theme.js";
import type { TabId } from "./AnalysisTabs.js";
import { TabBar, OverviewTab, RisksTab, SemanticTab, ArchTab } from "./AnalysisTabs.js";

// ── Types ─────────────────────────────────────────────────────────────────────

type PassPhase = { phase: "running" } | { phase: "done"; count: number };
type PassMap = Partial<Record<FindingPass, PassPhase>>;

interface ConvoMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChallengeState {
  finding: Finding;
  messages: ConvoMessage[];
  streaming: boolean;
  streamToken: string;
  input: string;
}

// ── Diff color tokens ─────────────────────────────────────────────────────────

const CODE = {
  gutterFg: "#4a463f",
  addBg: "oklch(0.32 0.045 150 / 0.32)",
  delBg: "oklch(0.32 0.05 25 / 0.32)",
  addMark: "oklch(0.65 0.06 150)",
  delMark: "oklch(0.60 0.08 25)",
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function severityColor(s: Finding["severity"] | null | undefined): string {
  const t = TOKENS.dark;
  if (s === "critical" || s === "high") return t.red;
  if (s === "medium") return t.amber;
  if (s === "low") return t.green;
  return t.textFaint;
}

function shortPath(p: string): string {
  const parts = p.split("/");
  return parts.length <= 2 ? p : parts.slice(-2).join("/");
}

function lineId(file: string, line: number): string {
  return `dl-${file.replace(/[^a-zA-Z0-9]/g, "_")}-${line}`;
}

function fileId(path: string): string {
  return `fs-${path.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

function hunkKey(filePath: string, hunkStart: number): string {
  return `${filePath}:${hunkStart}`;
}

function findingKey(f: Finding): string {
  return `${f.file}:${f.lines?.start ?? 0}:${f.title}`;
}

function formatAge(date: Date): string {
  const ms = Date.now() - date.getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "<1h";
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  return `${Math.floor(d / 30)}mo`;
}

function extractHunkContext(diff: Diff, finding: Finding): string {
  if (!finding.lines) return "";
  const file = diff.files.find((f) => f.newPath === finding.file);
  if (!file) return "";
  for (const hunk of file.hunks) {
    const end = hunk.newStart + hunk.newCount;
    if (finding.lines.start >= hunk.newStart && finding.lines.start < end) {
      return hunk.lines
        .map((l) => {
          const p = l.kind === "added" ? "+" : l.kind === "removed" ? "-" : " ";
          return `${p}${l.content}`;
        })
        .join("\n");
    }
  }
  return "";
}

function reviewSummary(findings: readonly Finding[], reviewDone: boolean): string {
  if (!reviewDone) return "Reviewing…";
  if (findings.length === 0) return "No findings — this PR looks clean.";
  const high = findings.filter((f) => f.severity === "critical" || f.severity === "high").length;
  const med = findings.filter((f) => f.severity === "medium").length;
  const low = findings.length - high - med;
  const parts: string[] = [];
  if (high) parts.push(`${high} high`);
  if (med) parts.push(`${med} medium`);
  if (low) parts.push(`${low} low`);
  return `Found ${findings.length} finding${findings.length !== 1 ? "s" : ""} — ${parts.join(", ")}.`;
}

// ── KbdHint ───────────────────────────────────────────────────────────────────

function KbdHint({ children, dark }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 10.5,
        padding: "1px 5px 2px",
        borderRadius: 3,
        background: dark ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.04)",
        color: dark ? "rgba(0,0,0,0.55)" : TOKENS.dark.textDim,
        border: dark ? "0.5px solid rgba(0,0,0,0.1)" : "0.5px solid rgba(255,255,255,0.06)",
      }}
    >
      {children}
    </span>
  );
}

// ── TopStrip ──────────────────────────────────────────────────────────────────

function TopStrip({ pr, onBack }: { pr: PullRequest; onBack: () => void }) {
  const t = TOKENS.dark;
  const ref = pr.ref;
  const repoLabel = ref.repo;
  const prNum = ref.platform === "github" ? ref.number : ref.id;

  return (
    <div
      style={
        {
          height: 48,
          display: "flex",
          alignItems: "center",
          gap: 18,
          padding: "0 24px",
          flexShrink: 0,
          borderBottom: `0.5px solid ${t.border}`,
          WebkitAppRegion: "drag",
        } as React.CSSProperties
      }
    >
      <div style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
        <button
          onClick={onBack}
          style={{
            background: "transparent",
            border: 0,
            color: t.textDim,
            cursor: "pointer",
            padding: "4px 8px 4px 0",
            fontFamily: SANS,
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
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
      </div>

      <div style={{ width: 0.5, height: 18, background: t.border, flexShrink: 0 }} />

      <div
        style={
          {
            display: "flex",
            alignItems: "baseline",
            gap: 12,
            minWidth: 0,
            flex: 1,
            WebkitAppRegion: "drag",
          } as React.CSSProperties
        }
      >
        <span
          style={{
            fontFamily: SANS,
            fontSize: 14,
            fontWeight: 500,
            letterSpacing: "-0.005em",
            color: t.text,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {pr.title}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: t.textFaint, flexShrink: 0 }}>
          #{prNum}
        </span>
      </div>

      <div
        style={
          {
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontFamily: MONO,
            fontSize: 11,
            color: t.textDim,
            flexShrink: 0,
            WebkitAppRegion: "drag",
          } as React.CSSProperties
        }
      >
        <span>{repoLabel}</span>
        <span style={{ color: t.textFaint }}>·</span>
        <span>{pr.author.login}</span>
        <span style={{ color: t.textFaint }}>·</span>
        <span>
          {pr.sourceBranch} <span style={{ color: t.textFaint }}>←</span> {pr.targetBranch}
        </span>
        <span style={{ color: t.textFaint }}>·</span>
        <span>{pr.state === "draft" ? "Draft" : "Open"}</span>
        <span style={{ color: t.textFaint }}>·</span>
        <span>{formatAge(pr.updatedAt)}</span>
      </div>
    </div>
  );
}

// ── FileRail ──────────────────────────────────────────────────────────────────

function FileRail({
  files,
  findings,
  activeIdx,
  onSelect,
}: {
  files: readonly FileDiff[];
  findings: readonly Finding[];
  activeIdx: number;
  onSelect: (idx: number) => void;
}) {
  const t = TOKENS.dark;

  const fileSeverity = useMemo(() => {
    const rank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
    const map = new Map<string, Finding["severity"] | null>();
    for (const f of findings) {
      const curr = map.get(f.file);
      if (!curr || (rank[f.severity] ?? 0) > (rank[curr] ?? 0)) {
        map.set(f.file, f.severity);
      }
    }
    return map;
  }, [findings]);

  return (
    <div
      style={{
        width: 240,
        flexShrink: 0,
        borderRight: `0.5px solid ${t.border}`,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "18px 20px 10px",
          fontSize: 10.5,
          letterSpacing: "0.1em",
          textTransform: "uppercase" as const,
          color: t.textFaint,
          fontFamily: SANS,
          flexShrink: 0,
        }}
      >
        Files
        <span
          style={{
            marginLeft: 8,
            letterSpacing: 0,
            textTransform: "none" as const,
            fontFamily: MONO,
          }}
        >
          {files.length}
        </span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "2px 8px 12px" }}>
        {files.map((file, idx) => {
          const isActive = idx === activeIdx;
          const sev = fileSeverity.get(file.newPath) ?? null;
          const statusColor =
            file.status === "added" ? t.green : file.status === "deleted" ? t.red : t.amber;
          const statusLabel =
            file.status === "added"
              ? "new"
              : file.status === "deleted"
                ? "del"
                : file.status === "renamed"
                  ? "ren"
                  : null;
          const adds = file.hunks.reduce(
            (s, h) => s + h.lines.filter((l) => l.kind === "added").length,
            0,
          );
          const dels = file.hunks.reduce(
            (s, h) => s + h.lines.filter((l) => l.kind === "removed").length,
            0,
          );

          return (
            <div
              key={file.newPath}
              onClick={() => onSelect(idx)}
              style={{
                position: "relative",
                padding: "10px 12px",
                borderRadius: 6,
                cursor: "default",
                marginBottom: 2,
                background: isActive ? t.selected : "transparent",
              }}
            >
              {isActive && (
                <span
                  style={{
                    position: "absolute",
                    left: -8,
                    top: 10,
                    bottom: 10,
                    width: 2,
                    background: t.accent,
                    borderRadius: 2,
                  }}
                />
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {sev ? (
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      flexShrink: 0,
                      background: severityColor(sev),
                    }}
                  />
                ) : (
                  <span style={{ width: 6, flexShrink: 0 }} />
                )}
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 12,
                    color: t.text,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap" as const,
                    flex: 1,
                  }}
                >
                  {shortPath(file.newPath)}
                </span>
                {statusLabel && (
                  <span
                    style={{
                      fontSize: 9.5,
                      color: statusColor,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase" as const,
                      fontFamily: SANS,
                    }}
                  >
                    {statusLabel}
                  </span>
                )}
              </div>
              <div
                style={{
                  marginTop: 4,
                  marginLeft: 14,
                  fontFamily: MONO,
                  fontSize: 10.5,
                  color: t.textFaint,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                +{adds} −{dels}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Diff center ───────────────────────────────────────────────────────────────

function InlineFindingRow({
  finding,
  expanded,
  onToggle,
  onAskVigil,
  hasAI,
}: {
  finding: Finding;
  expanded: boolean;
  onToggle: () => void;
  onAskVigil: () => void;
  hasAI: boolean;
}) {
  const t = TOKENS.dark;
  const color = severityColor(finding.severity);

  return (
    <div
      onClick={onToggle}
      style={{
        padding: "8px 18px 8px 100px",
        cursor: "default",
        background: expanded ? "rgba(255,255,255,0.015)" : "transparent",
        borderTop: `0.5px solid ${t.border}`,
        borderBottom: `0.5px solid ${t.border}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: color,
            marginTop: 7,
            flexShrink: 0,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: SANS,
              fontSize: 12.5,
              color: expanded ? t.text : t.textDim,
              lineHeight: 1.5,
              transition: "color .12s",
            }}
          >
            {finding.title}
          </div>
          {expanded && (
            <>
              <div
                style={{
                  marginTop: 8,
                  fontFamily: SANS,
                  fontSize: 12.5,
                  color: t.textDim,
                  lineHeight: 1.65,
                  maxWidth: 640,
                }}
              >
                {finding.description}
              </div>
              {finding.evidence && (
                <pre
                  style={{
                    marginTop: 8,
                    fontFamily: MONO,
                    fontSize: 11,
                    color: t.textDim,
                    background: t.surface,
                    border: `1px solid ${t.border}`,
                    borderRadius: 6,
                    padding: "6px 10px",
                    overflow: "auto",
                    whiteSpace: "pre-wrap" as const,
                    wordBreak: "break-all" as const,
                  }}
                >
                  {finding.evidence}
                </pre>
              )}
              <div style={{ marginTop: 10, display: "flex", gap: 14 }}>
                {hasAI && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onAskVigil();
                    }}
                    style={{
                      background: "transparent",
                      border: 0,
                      padding: 0,
                      color: t.accent,
                      fontFamily: SANS,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    Ask Vigil about this
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggle();
                  }}
                  style={{
                    background: "transparent",
                    border: 0,
                    padding: 0,
                    color: t.textDim,
                    fontFamily: SANS,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  Dismiss
                </button>
              </div>
            </>
          )}
        </div>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 10.5,
            color: t.textFaint,
            letterSpacing: "0.04em",
            flexShrink: 0,
          }}
        >
          vigil
        </span>
      </div>
    </div>
  );
}

function DiffRow({ line }: { line: DiffLine }) {
  const isAdd = line.kind === "added";
  const isDel = line.kind === "removed";
  const bg = isAdd ? CODE.addBg : isDel ? CODE.delBg : "transparent";
  const marker = isAdd ? "+" : isDel ? "−" : " ";
  const markerColor = isAdd ? CODE.addMark : isDel ? CODE.delMark : TOKENS.dark.textFaint;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "42px 42px 16px 1fr",
        background: bg,
        minHeight: 20,
        lineHeight: "20px",
      }}
    >
      <span
        style={{
          fontFamily: MONO,
          fontSize: 11.5,
          textAlign: "right" as const,
          paddingRight: 8,
          color: CODE.gutterFg,
          fontVariantNumeric: "tabular-nums",
          userSelect: "none" as const,
        }}
      >
        {line.oldLine ?? ""}
      </span>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 11.5,
          textAlign: "right" as const,
          paddingRight: 8,
          color: CODE.gutterFg,
          fontVariantNumeric: "tabular-nums",
          userSelect: "none" as const,
        }}
      >
        {line.newLine ?? ""}
      </span>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 12,
          textAlign: "center" as const,
          color: markerColor,
          userSelect: "none" as const,
        }}
      >
        {marker}
      </span>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 12.5,
          paddingRight: 18,
          whiteSpace: "pre" as const,
          color: TOKENS.dark.textDim,
        }}
      >
        {line.content}
      </span>
    </div>
  );
}

function HunkBlock({
  hunk,
  file,
  findingsByLine,
  expandedKeys,
  collapsed,
  onToggleCollapse,
  onToggleFinding,
  onAskVigil,
  hasAI,
}: {
  hunk: Hunk;
  file: FileDiff;
  findingsByLine: Map<string, Finding[]>;
  expandedKeys: Set<string>;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onToggleFinding: (key: string) => void;
  onAskVigil: (f: Finding) => void;
  hasAI: boolean;
}) {
  const t = TOKENS.dark;
  const header = `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`;

  return (
    <div>
      <div
        onClick={onToggleCollapse}
        style={{
          fontFamily: MONO,
          fontSize: 11,
          color: t.textFaint,
          background: `${t.accent}0f`,
          padding: "3px 12px",
          borderTop: `0.5px solid ${t.border}`,
          borderBottom: `0.5px solid ${t.border}`,
          userSelect: "none" as const,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <svg
          width="8"
          height="8"
          viewBox="0 0 8 8"
          fill="none"
          style={{
            flexShrink: 0,
            transition: "transform 0.1s",
            transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
          }}
        >
          <path
            d="M1 2.5L4 5.5L7 2.5"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>{header}</span>
        {collapsed && <span style={{ color: t.textFaint }}>· {hunk.lines.length} lines</span>}
      </div>
      {!collapsed &&
        hunk.lines.map((line, i) => {
          const lineFindings =
            line.newLine !== null
              ? (findingsByLine.get(`${file.newPath}:${line.newLine}`) ?? [])
              : [];
          const domId = line.newLine !== null ? lineId(file.newPath, line.newLine) : undefined;
          return (
            <div key={i} id={domId}>
              <DiffRow line={line} />
              {lineFindings.map((f) => {
                const key = findingKey(f);
                return (
                  <InlineFindingRow
                    key={key}
                    finding={f}
                    expanded={expandedKeys.has(key)}
                    onToggle={() => onToggleFinding(key)}
                    onAskVigil={() => onAskVigil(f)}
                    hasAI={hasAI}
                  />
                );
              })}
            </div>
          );
        })}
    </div>
  );
}

function FileSection({
  file,
  findingsByLine,
  expandedKeys,
  collapsedHunks,
  onToggleHunk,
  onToggleFinding,
  onAskVigil,
  hasAI,
}: {
  file: FileDiff;
  findingsByLine: Map<string, Finding[]>;
  expandedKeys: Set<string>;
  collapsedHunks: Set<string>;
  onToggleHunk: (key: string) => void;
  onToggleFinding: (key: string) => void;
  onAskVigil: (f: Finding) => void;
  hasAI: boolean;
}) {
  const t = TOKENS.dark;
  const adds = file.hunks.reduce((s, h) => s + h.lines.filter((l) => l.kind === "added").length, 0);
  const dels = file.hunks.reduce(
    (s, h) => s + h.lines.filter((l) => l.kind === "removed").length,
    0,
  );

  return (
    <div id={fileId(file.newPath)}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "16px 24px 10px",
          borderTop: `0.5px solid ${t.border}`,
          background: t.bg,
          position: "sticky" as const,
          top: 0,
          zIndex: 1,
        }}
      >
        <span style={{ fontFamily: MONO, fontSize: 12.5, color: t.text }}>{file.newPath}</span>
        {file.status === "added" && (
          <span
            style={{
              fontSize: 9.5,
              color: t.textFaint,
              letterSpacing: "0.08em",
              textTransform: "uppercase" as const,
            }}
          >
            new
          </span>
        )}
        {file.status === "renamed" && file.oldPath && (
          <span style={{ fontFamily: MONO, fontSize: 11, color: t.textFaint }}>
            ← {file.oldPath}
          </span>
        )}
        <span
          style={{
            fontFamily: MONO,
            fontSize: 11,
            color: t.textFaint,
            marginLeft: "auto",
          }}
        >
          +{adds} −{dels}
        </span>
      </div>
      {file.hunks.map((hunk, i) => {
        const key = hunkKey(file.newPath, hunk.newStart);
        return (
          <HunkBlock
            key={i}
            hunk={hunk}
            file={file}
            findingsByLine={findingsByLine}
            expandedKeys={expandedKeys}
            collapsed={collapsedHunks.has(key)}
            onToggleCollapse={() => onToggleHunk(key)}
            onToggleFinding={onToggleFinding}
            onAskVigil={onAskVigil}
            hasAI={hasAI}
          />
        );
      })}
      <div style={{ height: 6 }} />
    </div>
  );
}

function DiffCenter({
  diff,
  loadError,
  findings,
  expandedKeys,
  collapsedHunks,
  onToggleHunk,
  onToggleFinding,
  onAskVigil,
  hasAI,
  passes,
  reviewDone,
}: {
  diff: Diff | null;
  loadError: string | null;
  findings: readonly Finding[];
  expandedKeys: Set<string>;
  collapsedHunks: Set<string>;
  onToggleHunk: (key: string) => void;
  onToggleFinding: (key: string) => void;
  onAskVigil: (f: Finding) => void;
  hasAI: boolean;
  passes: PassMap;
  reviewDone: boolean;
}) {
  const t = TOKENS.dark;

  const findingsByLine = useMemo(() => {
    const map = new Map<string, Finding[]>();
    for (const f of findings) {
      if (!f.lines) continue;
      const key = `${f.file}:${f.lines.start}`;
      const arr = map.get(key) ?? [];
      arr.push(f);
      map.set(key, arr);
    }
    return map;
  }, [findings]);

  const runningPasses = Object.entries(passes).filter(([, v]) => v.phase === "running");

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: t.bg,
      }}
    >
      <div style={{ flex: 1, overflowY: "auto", overflowX: "auto" }}>
        {loadError ? (
          <div style={{ padding: 32, fontFamily: SANS, fontSize: 13, color: t.red }}>
            Failed to load diff: {loadError}
          </div>
        ) : !diff ? (
          <div style={{ padding: 32, fontFamily: SANS, fontSize: 13, color: t.textFaint }}>
            Loading diff…
          </div>
        ) : diff.files.length === 0 ? (
          <div style={{ padding: 32, fontFamily: SANS, fontSize: 13, color: t.textFaint }}>
            No changes in this PR.
          </div>
        ) : (
          diff.files.map((file, i) => (
            <FileSection
              key={i}
              file={file}
              findingsByLine={findingsByLine}
              expandedKeys={expandedKeys}
              collapsedHunks={collapsedHunks}
              onToggleHunk={onToggleHunk}
              onToggleFinding={onToggleFinding}
              onAskVigil={onAskVigil}
              hasAI={hasAI}
            />
          ))
        )}
        <div style={{ height: 24 }} />
      </div>

      {!reviewDone && runningPasses.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 16px",
            borderTop: `0.5px solid ${t.border}`,
            flexShrink: 0,
          }}
        >
          <span style={{ fontFamily: SANS, fontSize: 11, color: t.textFaint }}>Analyzing</span>
          {runningPasses.map(([pass]) => (
            <span
              key={pass}
              style={{
                fontFamily: MONO,
                fontSize: 11,
                color: t.accent,
                background: `${t.accent}18`,
                border: `0.5px solid ${t.accent}44`,
                borderRadius: 4,
                padding: "1px 6px",
              }}
            >
              {pass}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Conversation panel ────────────────────────────────────────────────────────

function ConversationPanel({
  challengeState,
  reviewDone,
  findings,
  hasAI,
  onInputChange,
  onSubmit,
}: {
  challengeState: ChallengeState | null;
  reviewDone: boolean;
  findings: readonly Finding[];
  hasAI: boolean;
  onInputChange: (v: string) => void;
  onSubmit: () => void;
}) {
  const t = TOKENS.dark;
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [challengeState?.messages.length, challengeState?.streamToken]);

  const summary = reviewSummary(findings, reviewDone);
  const isStreaming = challengeState?.streaming ?? false;
  const inputValue = challengeState?.input ?? "";

  return (
    <div
      style={{
        width: 320,
        flexShrink: 0,
        borderLeft: `0.5px solid ${t.border}`,
        display: "flex",
        flexDirection: "column",
        background: t.bg,
      }}
    >
      <div
        style={{
          padding: "18px 22px 12px",
          fontSize: 10.5,
          letterSpacing: "0.1em",
          textTransform: "uppercase" as const,
          color: t.textFaint,
          borderBottom: `0.5px solid ${t.border}`,
          fontFamily: SANS,
          flexShrink: 0,
        }}
      >
        Conversation
        {challengeState && (
          <span
            style={{
              marginLeft: 8,
              textTransform: "none" as const,
              letterSpacing: 0,
              fontFamily: MONO,
              fontSize: 10.5,
            }}
          >
            · {shortPath(challengeState.finding.file)}
          </span>
        )}
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "20px 22px" }}>
        {!challengeState ? (
          <div
            style={{
              fontFamily: SANS,
              fontSize: 13,
              color: t.text,
              lineHeight: 1.65,
              letterSpacing: "0.002em",
            }}
          >
            {summary}
          </div>
        ) : (
          <>
            {challengeState.messages.map((msg, i) => (
              <div key={i} style={{ marginBottom: 22 }}>
                {msg.role === "user" ? (
                  <div
                    style={{
                      fontFamily: SANS,
                      fontSize: 13,
                      color: t.text,
                      lineHeight: 1.55,
                      paddingLeft: 12,
                      borderLeft: `1.5px solid ${t.border}`,
                    }}
                  >
                    {msg.content}
                  </div>
                ) : (
                  <div
                    style={{
                      fontFamily: SANS,
                      fontSize: 13,
                      color: t.text,
                      lineHeight: 1.65,
                      letterSpacing: "0.002em",
                    }}
                  >
                    {msg.content}
                  </div>
                )}
              </div>
            ))}
            {isStreaming && (
              <div style={{ marginBottom: 22 }}>
                <div
                  style={{
                    fontFamily: SANS,
                    fontSize: 13,
                    color: t.text,
                    lineHeight: 1.65,
                    letterSpacing: "0.002em",
                  }}
                >
                  {challengeState.streamToken}
                  <span
                    style={
                      {
                        display: "inline-block",
                        width: 7,
                        height: 14,
                        background: t.accent,
                        marginLeft: 2,
                        verticalAlign: -2,
                        animation: "vigil-blink 1.1s steps(2, end) infinite",
                      } as React.CSSProperties
                    }
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {hasAI && (
        <div
          style={{
            borderTop: `0.5px solid ${t.border}`,
            padding: "12px 16px 14px",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "9px 12px",
              borderRadius: 8,
              background: t.surface,
            }}
          >
            <input
              placeholder={
                challengeState ? "Ask a follow-up…" : "Expand a finding to start a conversation…"
              }
              value={inputValue}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  onSubmit();
                }
              }}
              disabled={!challengeState || isStreaming}
              style={{
                flex: 1,
                border: 0,
                background: "transparent",
                color: t.text,
                fontFamily: SANS,
                fontSize: 13,
                outline: "none",
              }}
            />
            <KbdHint>⌘↵</KbdHint>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Verdict compose overlay ───────────────────────────────────────────────────

function VerdictCompose({
  verdict,
  body,
  onBodyChange,
  onClose,
  onSubmit,
  submitting,
}: {
  verdict: ReviewVerdict;
  body: string;
  onBodyChange: (v: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const t = TOKENS.dark;
  const label =
    verdict === "approved"
      ? "Approve"
      : verdict === "changes_requested"
        ? "Request changes"
        : "Comment";
  const color =
    verdict === "approved" ? t.green : verdict === "changes_requested" ? t.red : t.textDim;

  return (
    <div
      style={{
        position: "absolute" as const,
        bottom: 48,
        left: 0,
        right: 0,
        padding: "16px 24px",
        background: t.bg,
        borderTop: `0.5px solid ${t.border}`,
        zIndex: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ fontFamily: SANS, fontSize: 13, fontWeight: 500, color }}>{label}</span>
        <button
          onClick={onClose}
          style={{
            marginLeft: "auto",
            background: "transparent",
            border: 0,
            color: t.textFaint,
            cursor: "pointer",
            fontFamily: SANS,
            fontSize: 12,
            padding: "2px 8px",
          }}
        >
          Cancel
        </button>
      </div>
      <textarea
        value={body}
        onChange={(e) => onBodyChange(e.target.value)}
        placeholder={
          verdict === "approved" ? "Optional summary comment…" : "Describe what needs to change…"
        }
        rows={3}
        autoFocus
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            onSubmit();
          }
          if (e.key === "Escape") onClose();
        }}
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
          marginBottom: 10,
          boxSizing: "border-box" as const,
        }}
      />
      <button
        onClick={onSubmit}
        disabled={submitting}
        style={{
          fontFamily: SANS,
          fontSize: 13,
          fontWeight: 500,
          color: submitting ? t.textFaint : t.bg,
          background: submitting ? t.surface : t.accent,
          border: "none",
          borderRadius: 8,
          padding: "8px 20px",
          cursor: submitting ? "default" : "pointer",
          transition: "background 150ms, color 150ms",
        }}
      >
        {submitting ? "Submitting…" : `Submit ${label.toLowerCase()}`}
      </button>
    </div>
  );
}

// ── Bottom strip ──────────────────────────────────────────────────────────────

function BottomStrip({
  onComment,
  onRequestChanges,
  onApprove,
  submitting,
  submitted,
  prUrl,
}: {
  onComment: () => void;
  onRequestChanges: () => void;
  onApprove: () => void;
  submitting: boolean;
  submitted: boolean;
  prUrl: string;
}) {
  const t = TOKENS.dark;

  if (submitted) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "0 24px",
          height: 48,
          flexShrink: 0,
          borderTop: `0.5px solid ${t.border}`,
          gap: 16,
        }}
      >
        <span style={{ fontFamily: SANS, fontSize: 13, color: t.green, fontWeight: 500 }}>
          Review submitted
        </span>
        <a
          href={prUrl}
          onClick={(e) => {
            e.preventDefault();
            window.open(prUrl, "_blank");
          }}
          style={{ fontFamily: MONO, fontSize: 11, color: t.accent }}
        >
          View on platform →
        </a>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "0 24px",
        height: 48,
        flexShrink: 0,
        borderTop: `0.5px solid ${t.border}`,
        gap: 18,
      }}
    >
      <div
        style={{
          fontFamily: MONO,
          fontSize: 11,
          color: t.textFaint,
          display: "flex",
          gap: 14,
          alignItems: "center",
        }}
      >
        <span>
          <KbdHint>j</KbdHint> <KbdHint>k</KbdHint>
          <span style={{ marginLeft: 8 }}>files</span>
        </span>
        <span>
          <KbdHint>n</KbdHint> <KbdHint>p</KbdHint>
          <span style={{ marginLeft: 8 }}>findings</span>
        </span>
        <KbdHint>?</KbdHint>
      </div>
      <div style={{ flex: 1 }} />
      <button
        onClick={onComment}
        disabled={submitting}
        style={{
          background: "transparent",
          border: 0,
          padding: "8px 12px",
          fontFamily: SANS,
          fontSize: 13,
          color: t.textDim,
          cursor: "pointer",
        }}
      >
        Comment
      </button>
      <button
        onClick={onRequestChanges}
        disabled={submitting}
        style={{
          background: "transparent",
          border: 0,
          padding: "8px 12px",
          fontFamily: SANS,
          fontSize: 13,
          color: t.textDim,
          cursor: "pointer",
        }}
      >
        Request changes
      </button>
      <button
        onClick={onApprove}
        disabled={submitting}
        style={{
          background: t.accent,
          border: 0,
          padding: "8px 18px",
          borderRadius: 7,
          fontFamily: SANS,
          fontSize: 13,
          fontWeight: 500,
          color: "#0c1416",
          cursor: "pointer",
          letterSpacing: "-0.005em",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        Approve
        <KbdHint dark>m</KbdHint>
      </button>
    </div>
  );
}

// ── WorkspaceScreen ───────────────────────────────────────────────────────────

export function WorkspaceScreen({ pr, onBack }: { pr: PullRequest; onBack: () => void }) {
  const [diff, setDiff] = useState<Diff | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [passes, setPasses] = useState<PassMap>({});
  const [reviewDone, setReviewDone] = useState(false);
  const [hasAI, setHasAI] = useState(false);

  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [reviewCompletedAt, setReviewCompletedAt] = useState<Date | null>(null);

  const [activeFileIdx, setActiveFileIdx] = useState(0);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [collapsedHunks, setCollapsedHunks] = useState<Set<string>>(new Set());
  const [focusedFindingIdx, setFocusedFindingIdx] = useState<number | null>(null);
  const [challengeState, setChallengeState] = useState<ChallengeState | null>(null);
  const [verdictState, setVerdictState] = useState<{
    verdict: ReviewVerdict;
    body: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const regressionFindings = useMemo(
    () => findings.filter((f) => f.pass === "regression"),
    [findings],
  );

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

  const focusedFinding =
    focusedFindingIdx !== null ? (sortedFindings[focusedFindingIdx] ?? null) : null;

  // Load diff + settings + start review
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
      const headSha = diffResult.value.pr.headSha;

      if (settingsResult.ok) {
        setHasAI(
          (settingsResult.value.aiProvider === "anthropic" &&
            settingsResult.value.hasAnthropicKey) ||
            (settingsResult.value.aiProvider === "openai" && settingsResult.value.hasOpenAIKey),
        );
      }

      const cached = await api.invoke("review:getCached", pr.ref, headSha);
      if (!mounted) return;

      if (cached.ok && cached.value) {
        setFindings([...cached.value.findings]);
        setReviewDone(true);
        setReviewCompletedAt(new Date());
        return;
      }

      const result = await api.invoke("review:run", pr.ref);
      if (!mounted) return;
      if (result.ok) setFindings([...result.value.findings]);
      setReviewDone(true);
      setReviewCompletedAt(new Date());
    }

    void init();
    return () => {
      mounted = false;
    };
  }, [pr]);

  // Stream review events + challenge chunks
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

    const offChunk = api.on("review:challengeChunk", ({ token, done }) => {
      setChallengeState((prev) => {
        if (!prev) return null;
        if (done) {
          return {
            ...prev,
            messages: [...prev.messages, { role: "assistant", content: prev.streamToken + token }],
            streaming: false,
            streamToken: "",
          };
        }
        return { ...prev, streamToken: prev.streamToken + token };
      });
    });

    return () => {
      offFinding();
      offPass();
      offChunk();
    };
  }, []);

  // Scroll to focused finding, auto-expand it, and uncollapse its hunk
  useEffect(() => {
    if (!focusedFinding?.lines) return;

    // Uncollapse the containing hunk so the finding is visible
    if (diff) {
      const file = diff.files.find((f) => f.newPath === focusedFinding.file);
      const containingHunk = file?.hunks.find(
        (h) =>
          focusedFinding.lines!.start >= h.newStart &&
          focusedFinding.lines!.start < h.newStart + h.newCount,
      );
      if (containingHunk) {
        const key = hunkKey(focusedFinding.file, containingHunk.newStart);
        setCollapsedHunks((prev) => {
          if (!prev.has(key)) return prev;
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    }

    const el = document.getElementById(lineId(focusedFinding.file, focusedFinding.lines.start));
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    const key = findingKey(focusedFinding);
    setExpandedKeys((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, [focusedFinding, diff]);

  // Scroll to active file
  useEffect(() => {
    if (!diff) return;
    const file = diff.files[activeFileIdx];
    if (!file) return;
    document
      .getElementById(fileId(file.newPath))
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [activeFileIdx, diff]);

  async function handleChallengeSubmit() {
    if (!challengeState?.input.trim() || challengeState.streaming || !diff) return;
    const userMsg: ConvoMessage = { role: "user", content: challengeState.input.trim() };
    const newMessages = [...challengeState.messages, userMsg];
    const hunkContext = extractHunkContext(diff, challengeState.finding);
    setChallengeState({
      ...challengeState,
      messages: newMessages,
      streaming: true,
      streamToken: "",
      input: "",
    });
    await api.invoke("review:challenge", pr.ref, challengeState.finding, hunkContext, newMessages);
  }

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const inField =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (inField) return;

      if (e.key === "Tab") {
        e.preventDefault();
        const tabOrder: TabId[] = ["overview", "diff", "semantic", "risks", "arch", "convo"];
        const curr = tabOrder.indexOf(activeTab);
        setActiveTab(
          e.shiftKey
            ? (tabOrder[(curr - 1 + tabOrder.length) % tabOrder.length] ?? "diff")
            : (tabOrder[(curr + 1) % tabOrder.length] ?? "diff"),
        );
        return;
      }
      if (e.key === "Escape") {
        if (verdictState) {
          setVerdictState(null);
        } else if (challengeState) {
          setChallengeState(null);
        } else if (focusedFindingIdx !== null) {
          setFocusedFindingIdx(null);
        } else {
          onBack();
        }
        return;
      }
      if (e.key === "j") {
        e.preventDefault();
        if (!diff) return;
        setActiveFileIdx((i) => Math.min(diff.files.length - 1, i + 1));
      }
      if (e.key === "k") {
        e.preventDefault();
        setActiveFileIdx((i) => Math.max(0, i - 1));
      }
      if (e.key === "n") {
        e.preventDefault();
        if (sortedFindings.length === 0) return;
        setFocusedFindingIdx((i) => (i === null ? 0 : Math.min(sortedFindings.length - 1, i + 1)));
      }
      if (e.key === "p") {
        e.preventDefault();
        if (sortedFindings.length === 0) return;
        setFocusedFindingIdx((i) => (i === null ? sortedFindings.length - 1 : Math.max(0, i - 1)));
      }
      if (e.key === "m") {
        setVerdictState({ verdict: "approved", body: "" });
      }
    },
    [
      diff,
      sortedFindings.length,
      focusedFindingIdx,
      verdictState,
      challengeState,
      onBack,
      activeTab,
    ],
  );

  function handleToggleFinding(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleToggleHunk(key: string) {
    setCollapsedHunks((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleAskVigil(finding: Finding) {
    setChallengeState({
      finding,
      messages: [{ role: "assistant", content: `${finding.title}\n\n${finding.description}` }],
      streaming: false,
      streamToken: "",
      input: "",
    });
  }

  async function handleSubmitReview() {
    if (!verdictState) return;
    setSubmitting(true);
    const review: NewReview = {
      verdict: verdictState.verdict,
      body: verdictState.body,
      comments: [],
    };
    const result = await api.invoke("platform:submitReview", pr.ref, review);
    if (result.ok) {
      setSubmitted(true);
      setVerdictState(null);
    }
    setSubmitting(false);
  }

  const files = diff?.files ?? [];

  return (
    <div
      tabIndex={0}
      onKeyDown={handleKeyDown}
      style={{
        width: "100%",
        height: "100%",
        background: TOKENS.dark.bg,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        outline: "none",
        position: "relative" as const,
      }}
    >
      <TopStrip pr={pr} onBack={onBack} />
      <TabBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        findings={findings}
        reviewCompletedAt={reviewCompletedAt}
      />

      {activeTab === "diff" ? (
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          <FileRail
            files={files}
            findings={findings}
            activeIdx={activeFileIdx}
            onSelect={setActiveFileIdx}
          />
          <DiffCenter
            diff={diff}
            loadError={loadError}
            findings={findings}
            expandedKeys={expandedKeys}
            collapsedHunks={collapsedHunks}
            onToggleHunk={handleToggleHunk}
            onToggleFinding={handleToggleFinding}
            onAskVigil={handleAskVigil}
            hasAI={hasAI}
            passes={passes}
            reviewDone={reviewDone}
          />
          <ConversationPanel
            challengeState={challengeState}
            reviewDone={reviewDone}
            findings={findings}
            hasAI={hasAI}
            onInputChange={(v) =>
              setChallengeState((prev) => (prev ? { ...prev, input: v } : null))
            }
            onSubmit={() => void handleChallengeSubmit()}
          />
        </div>
      ) : activeTab === "overview" ? (
        <div style={{ flex: 1, overflow: "hidden" }}>
          <OverviewTab
            pr={pr}
            findings={findings}
            diff={diff}
            passes={passes}
            reviewDone={reviewDone}
            reviewCompletedAt={reviewCompletedAt}
          />
        </div>
      ) : activeTab === "risks" ? (
        <div style={{ flex: 1, overflow: "hidden" }}>
          <RisksTab findings={regressionFindings} />
        </div>
      ) : activeTab === "convo" ? (
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          <ConversationPanel
            challengeState={challengeState}
            reviewDone={reviewDone}
            findings={findings}
            hasAI={hasAI}
            onInputChange={(v) =>
              setChallengeState((prev) => (prev ? { ...prev, input: v } : null))
            }
            onSubmit={() => void handleChallengeSubmit()}
          />
        </div>
      ) : activeTab === "semantic" ? (
        <div style={{ flex: 1, overflow: "hidden" }}>
          <SemanticTab />
        </div>
      ) : activeTab === "arch" ? (
        <div style={{ flex: 1, overflow: "hidden" }}>
          <ArchTab />
        </div>
      ) : null}

      {verdictState && (
        <VerdictCompose
          verdict={verdictState.verdict}
          body={verdictState.body}
          onBodyChange={(v) => setVerdictState((prev) => (prev ? { ...prev, body: v } : null))}
          onClose={() => setVerdictState(null)}
          onSubmit={() => void handleSubmitReview()}
          submitting={submitting}
        />
      )}

      <BottomStrip
        onComment={() => setVerdictState({ verdict: "commented", body: "" })}
        onRequestChanges={() => setVerdictState({ verdict: "changes_requested", body: "" })}
        onApprove={() => setVerdictState({ verdict: "approved", body: "" })}
        submitting={submitting}
        submitted={submitted}
        prUrl={pr.url}
      />
    </div>
  );
}
