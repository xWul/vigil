import { useMemo } from "react";

import type { Diff, PullRequest } from "../../../shared/model/index.js";
import type { Finding, FindingPass } from "../../../shared/review.js";
import { TOKENS, SANS, MONO } from "../../shared/theme.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type TabId = "overview" | "diff" | "semantic" | "risks" | "arch" | "convo";

type PassPhase = { phase: "running" } | { phase: "done"; count: number };
export type PassMap = Partial<Record<FindingPass, PassPhase>>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function severityRank(s: Finding["severity"]): number {
  return { critical: 5, high: 4, medium: 3, low: 2, info: 1 }[s] ?? 0;
}

function severityColor(s: Finding["severity"] | "med" | null | undefined): string {
  const t = TOKENS.dark;
  if (s === "critical" || s === "high") return t.red;
  if (s === "medium" || s === "med") return t.amber;
  if (s === "low") return t.green;
  return t.textFaint;
}

function formatAge(date: Date): string {
  const ms = Date.now() - date.getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function shortPath(p: string): string {
  const parts = p.split("/");
  return parts.length <= 2 ? p : parts.slice(-2).join("/");
}

function parseEvidence(evidence: string): { removed: string[]; added: string[] } {
  const removed: string[] = [];
  const added: string[] = [];
  for (const raw of evidence.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("- ")) removed.push(line.slice(2));
    else if (line.startsWith("+ ")) added.push(line.slice(2));
  }
  return { removed, added };
}

function impactLabel(f: Finding): string {
  const t = f.title.toLowerCase();
  if (t.includes("catch") || t.includes("error") || t.includes("throw")) return "Error handling";
  if (t.includes("condition") || t.includes("operator")) return "Logic";
  if (t.includes("await") || t.includes("promise")) return "Execution order";
  if (t.includes("side effect") || t.includes("localstorage") || t.includes("cookie"))
    return "State";
  if (t.includes("timeout") || t.includes("retry") || t.includes("limit") || t.includes("delay"))
    return "Configuration";
  return "Behavior";
}

// ── Shared atoms ──────────────────────────────────────────────────────────────

function RiskDot({ sev, size = 6 }: { sev: Finding["severity"] | "med" | null; size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: severityColor(sev),
        display: "inline-block",
        flexShrink: 0,
      }}
    />
  );
}

function UpperLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        color: TOKENS.dark.textFaint,
        letterSpacing: "0.08em",
        textTransform: "uppercase" as const,
        marginBottom: 6,
        fontFamily: MONO,
      }}
    >
      {children}
    </div>
  );
}

// ── TabBar ────────────────────────────────────────────────────────────────────

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "diff", label: "Diff" },
  { id: "semantic", label: "Semantic" },
  { id: "risks", label: "Silent risks" },
  { id: "arch", label: "Architecture" },
  { id: "convo", label: "Conversation" },
];

export function TabBar({
  activeTab,
  onTabChange,
  findings,
  reviewCompletedAt,
}: {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  findings: readonly Finding[];
  reviewCompletedAt: Date | null;
}) {
  const t = TOKENS.dark;

  const diffCount = findings.filter((f) => f.lines !== null).length;
  const riskCount = findings.filter((f) => f.pass === "regression").length;
  const riskHigh = findings.some(
    (f) => f.pass === "regression" && (f.severity === "high" || f.severity === "critical"),
  );

  function tabCount(id: TabId): { n: number; sev: "high" | "med" | null } | null {
    if (id === "diff" && diffCount > 0) return { n: diffCount, sev: null };
    if (id === "risks" && riskCount > 0) return { n: riskCount, sev: riskHigh ? "high" : "med" };
    return null;
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 0,
        padding: "0 24px",
        height: 42,
        flexShrink: 0,
        borderBottom: `0.5px solid ${t.border}`,
      }}
    >
      {TABS.map((tab) => {
        const isActive = tab.id === activeTab;
        const count = tabCount(tab.id);
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "0 14px",
              height: "100%",
              cursor: "default",
              background: "transparent",
              border: 0,
              color: isActive ? t.text : t.textDim,
              fontFamily: SANS,
              fontSize: 13,
              letterSpacing: "-0.005em",
              transition: "color .12s",
            }}
          >
            <span>{tab.label}</span>
            {count && (
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  fontFamily: MONO,
                  fontSize: 10.5,
                  color: isActive ? t.text : t.textFaint,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {count.n}
                {count.sev && <RiskDot sev={count.sev === "high" ? "high" : "medium"} size={5} />}
              </span>
            )}
            {isActive && (
              <span
                style={{
                  position: "absolute",
                  left: 8,
                  right: 8,
                  bottom: -0.5,
                  height: 1.5,
                  background: t.accent,
                }}
              />
            )}
          </button>
        );
      })}
      <div style={{ flex: 1 }} />
      {reviewCompletedAt && (
        <div
          style={{
            height: "100%",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: MONO,
            fontSize: 10.5,
            color: t.textFaint,
          }}
        >
          <span>analyzed {formatAge(reviewCompletedAt)}</span>
        </div>
      )}
    </div>
  );
}

// ── OverviewTab ───────────────────────────────────────────────────────────────

function PulseMetric({
  label,
  value,
  unit,
  note,
  noteColor,
  last,
}: {
  label: string;
  value: string | number;
  unit?: string;
  note?: string;
  noteColor?: string;
  last?: boolean;
}) {
  const t = TOKENS.dark;
  return (
    <div
      style={{
        padding: "20px 28px",
        borderRight: last ? "none" : `0.5px solid ${t.border}`,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: t.textFaint,
          letterSpacing: "0.06em",
          textTransform: "uppercase" as const,
          fontFamily: SANS,
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 28,
            color: t.text,
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.02em",
            lineHeight: 1,
          }}
        >
          {value}
        </span>
        {unit && <span style={{ fontFamily: MONO, fontSize: 12, color: t.textFaint }}>{unit}</span>}
      </div>
      {note && (
        <div
          style={{
            fontFamily: MONO,
            fontSize: 11,
            color: noteColor ?? t.textDim,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {note}
        </div>
      )}
    </div>
  );
}

export function OverviewTab({
  pr,
  findings,
  diff,
  passes,
  reviewDone,
  reviewCompletedAt,
}: {
  pr: PullRequest;
  findings: readonly Finding[];
  diff: Diff | null;
  passes: PassMap;
  reviewDone: boolean;
  reviewCompletedAt: Date | null;
}) {
  const t = TOKENS.dark;

  const highCount = findings.filter(
    (f) => f.severity === "critical" || f.severity === "high",
  ).length;
  const medCount = findings.filter((f) => f.severity === "medium").length;
  const regressionCount = findings.filter((f) => f.pass === "regression").length;
  const filesChanged = diff?.files.length ?? 0;
  const linesAdded =
    diff?.files.reduce(
      (s, f) =>
        s + f.hunks.reduce((hs, h) => hs + h.lines.filter((l) => l.kind === "added").length, 0),
      0,
    ) ?? 0;
  const linesDeleted =
    diff?.files.reduce(
      (s, f) =>
        s + f.hunks.reduce((hs, h) => hs + h.lines.filter((l) => l.kind === "removed").length, 0),
      0,
    ) ?? 0;

  const topFindings = useMemo(
    () =>
      [...findings]
        .filter((f) => f.severity !== "info")
        .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
        .slice(0, 5),
    [findings],
  );

  const passEntries = Object.entries(passes) as [FindingPass, PassPhase][];
  const passLabels: Partial<Record<FindingPass, string>> = {
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

  return (
    <div style={{ width: "100%", height: "100%", overflowY: "auto" }}>
      {/* Pulse strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(6, 1fr)",
          borderBottom: `0.5px solid ${t.border}`,
        }}
      >
        <PulseMetric
          label="Findings"
          value={findings.length}
          note={
            highCount > 0
              ? `${highCount} high`
              : medCount > 0
                ? `${medCount} medium`
                : reviewDone
                  ? "none critical"
                  : "running…"
          }
          noteColor={
            highCount > 0 ? t.red : medCount > 0 ? t.amber : reviewDone ? t.green : t.textFaint
          }
        />
        <PulseMetric
          label="High risk"
          value={highCount}
          note={highCount > 0 ? "needs attention" : "none"}
          noteColor={highCount > 0 ? t.red : t.textFaint}
        />
        <PulseMetric
          label="Regression"
          value={regressionCount}
          note={regressionCount > 0 ? "behavioral" : "none detected"}
          noteColor={regressionCount > 0 ? t.amber : t.textFaint}
        />
        <PulseMetric label="Files" value={filesChanged} note={`+${linesAdded} −${linesDeleted}`} />
        <PulseMetric
          label="Passes"
          value={passEntries.filter(([, v]) => v.phase === "done").length}
          unit={`/ ${passEntries.length}`}
          note={reviewDone ? "complete" : "running"}
          noteColor={reviewDone ? t.textFaint : t.accent}
        />
        <PulseMetric
          label="Author"
          value={pr.author.login}
          note={`${pr.state} · ${pr.sourceBranch}`}
          last
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 300px",
          minHeight: "calc(100% - 100px)",
        }}
      >
        {/* Main content */}
        <div
          style={{
            padding: "28px 32px",
            overflowY: "auto",
            borderRight: `0.5px solid ${t.border}`,
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: t.textFaint,
              letterSpacing: "0.1em",
              textTransform: "uppercase" as const,
              marginBottom: 14,
              fontFamily: SANS,
            }}
          >
            Summary
          </div>
          <p
            style={{
              margin: "0 0 32px",
              fontSize: 14,
              color: t.text,
              lineHeight: 1.7,
              letterSpacing: "-0.003em",
              maxWidth: 640,
            }}
          >
            {pr.title}. This PR modifies{" "}
            <span style={{ fontFamily: MONO, fontSize: 13 }}>{filesChanged}</span> file
            {filesChanged !== 1 ? "s" : ""} (+{linesAdded} −{linesDeleted} lines).
            {findings.length > 0
              ? ` Vigil found ${findings.length} finding${findings.length !== 1 ? "s" : ""}${highCount > 0 ? `, including ${highCount} high-severity item${highCount !== 1 ? "s" : ""} that need attention` : ""}.`
              : reviewDone
                ? " No issues found."
                : " Review in progress."}
          </p>

          {topFindings.length > 0 && (
            <>
              <div
                style={{
                  fontSize: 11,
                  color: t.textFaint,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase" as const,
                  marginBottom: 14,
                  fontFamily: SANS,
                }}
              >
                Worth your attention
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {topFindings.map((f, i) => (
                  <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <RiskDot sev={f.severity} size={7} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13.5,
                          color: t.text,
                          letterSpacing: "-0.003em",
                          lineHeight: 1.5,
                          fontFamily: SANS,
                        }}
                      >
                        {f.title}
                      </div>
                      <div
                        style={{
                          marginTop: 3,
                          fontFamily: MONO,
                          fontSize: 11,
                          color: t.textFaint,
                        }}
                      >
                        {f.file ? shortPath(f.file) : f.pass}
                        {f.lines ? `:${f.lines.start}` : ""}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {passEntries.length > 0 && (
            <div style={{ marginTop: 32 }}>
              <div
                style={{
                  fontSize: 11,
                  color: t.textFaint,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase" as const,
                  marginBottom: 12,
                  fontFamily: SANS,
                }}
              >
                Analysis passes
              </div>
              <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 8 }}>
                {passEntries.map(([pass, state]) => (
                  <span
                    key={pass}
                    style={{
                      fontFamily: MONO,
                      fontSize: 11,
                      color: state.phase === "done" ? t.textDim : t.accent,
                      background: state.phase === "done" ? t.surface : `${t.accent}18`,
                      border: `0.5px solid ${state.phase === "done" ? t.border : `${t.accent}44`}`,
                      borderRadius: 4,
                      padding: "2px 8px",
                    }}
                  >
                    {state.phase === "running" ? "⟳ " : "✓ "}
                    {passLabels[pass] ?? pass}
                    {state.phase === "done" && state.count > 0 ? ` · ${state.count}` : ""}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Activity rail */}
        <div style={{ padding: "28px 24px", overflowY: "auto" }}>
          <div
            style={{
              fontSize: 11,
              color: t.textFaint,
              letterSpacing: "0.1em",
              textTransform: "uppercase" as const,
              marginBottom: 18,
              fontFamily: SANS,
            }}
          >
            Activity
          </div>
          <div style={{ position: "relative" }}>
            <div
              style={{
                position: "absolute",
                left: 5,
                top: 6,
                bottom: 6,
                width: 0.5,
                background: t.border,
              }}
            />
            {[
              {
                when: pr.createdAt,
                who: pr.author.login,
                text: `Opened PR · ${filesChanged} files, +${linesAdded} −${linesDeleted}`,
              },
              reviewCompletedAt
                ? {
                    when: reviewCompletedAt,
                    who: "vigil",
                    text: `Analysis completed · ${findings.length} finding${findings.length !== 1 ? "s" : ""}`,
                  }
                : null,
              pr.updatedAt > pr.createdAt
                ? { when: pr.updatedAt, who: pr.author.login, text: "Last updated" }
                : null,
            ]
              .filter(Boolean)
              .map((a, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 14,
                    paddingBottom: 18,
                    position: "relative",
                  }}
                >
                  <span
                    style={{
                      width: 11,
                      height: 11,
                      borderRadius: "50%",
                      background: t.bg,
                      border: `1px solid ${t.border}`,
                      flexShrink: 0,
                      marginTop: 3,
                      position: "relative",
                      zIndex: 1,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontFamily: MONO,
                        fontSize: 10.5,
                        color: t.textFaint,
                        marginBottom: 3,
                      }}
                    >
                      {formatAge(a!.when)} · {a!.who}
                    </div>
                    <div
                      style={{
                        fontFamily: SANS,
                        fontSize: 12.5,
                        color: t.text,
                        lineHeight: 1.55,
                      }}
                    >
                      {a!.text}
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── RisksTab ──────────────────────────────────────────────────────────────────

function EvidenceCell({ evidence }: { evidence: string }) {
  const t = TOKENS.dark;
  const { removed, added } = parseEvidence(evidence);

  if (!removed.length && !added.length) {
    return (
      <div style={{ fontFamily: SANS, fontSize: 12.5, color: t.text, lineHeight: 1.6 }}>
        {evidence.trim()}
      </div>
    );
  }

  return (
    <div style={{ fontFamily: MONO, fontSize: 12, color: t.text, lineHeight: 1.7 }}>
      {removed.map((line, i) => (
        <div key={`r${i}`} style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ color: TOKENS.dark.red }}>−</span>
          <span
            style={{
              background: "oklch(0.32 0.05 25 / 0.32)",
              padding: "0 4px",
              borderRadius: 2,
            }}
          >
            {line}
          </span>
        </div>
      ))}
      {added.map((line, i) => (
        <div
          key={`a${i}`}
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 6,
            marginTop: removed.length > 0 ? 4 : 0,
          }}
        >
          <span style={{ color: TOKENS.dark.green }}>+</span>
          <span
            style={{
              background: "oklch(0.32 0.045 150 / 0.32)",
              padding: "0 4px",
              borderRadius: 2,
            }}
          >
            {line}
          </span>
        </div>
      ))}
    </div>
  );
}

export function RisksTab({ findings }: { findings: readonly Finding[] }) {
  const t = TOKENS.dark;

  const highCount = findings.filter(
    (f) => f.severity === "critical" || f.severity === "high",
  ).length;
  const medCount = findings.filter((f) => f.severity === "medium").length;
  const lowCount = findings.filter((f) => f.severity === "low").length;

  const sorted = useMemo(
    () => [...findings].sort((a, b) => severityRank(b.severity) - severityRank(a.severity)),
    [findings],
  );

  if (findings.length === 0) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: SANS,
          fontSize: 13,
          color: t.textFaint,
        }}
      >
        No silent regressions detected.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100%" }}>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {/* Hero */}
        <div
          style={{
            padding: "28px 32px",
            borderBottom: `0.5px solid ${t.border}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <div
              style={{
                fontFamily: SANS,
                fontSize: 13,
                color: t.textDim,
                maxWidth: 460,
                lineHeight: 1.55,
              }}
            >
              Behavioral changes that may introduce bugs without failing existing tests. Ranked by
              severity.
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 18,
                fontFamily: MONO,
                fontSize: 11,
                color: t.textDim,
                flexShrink: 0,
              }}
            >
              {highCount > 0 && (
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <RiskDot sev="high" size={6} />
                  <span style={{ color: t.text }}>{highCount}</span>
                  {" high"}
                </span>
              )}
              {medCount > 0 && (
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <RiskDot sev="medium" size={6} />
                  <span style={{ color: t.text }}>{medCount}</span>
                  {" medium"}
                </span>
              )}
              {lowCount > 0 && (
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <RiskDot sev="low" size={6} />
                  <span style={{ color: t.text }}>{lowCount}</span>
                  {" low"}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Table rows */}
        {sorted.map((f, i) => {
          const path = f.file ? `${shortPath(f.file)}${f.lines ? `:${f.lines.start}` : ""}` : "";
          return (
            <div
              key={i}
              style={{
                position: "relative",
                padding: "18px 32px 18px 36px",
                borderBottom: `0.5px solid ${t.border}`,
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "160px 1.4fr 2fr 120px",
                  gap: 28,
                  alignItems: "flex-start",
                }}
              >
                {/* Risk + area + path */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <RiskDot sev={f.severity} size={7} />
                    <span
                      style={{
                        fontFamily: MONO,
                        fontSize: 10.5,
                        color: t.textFaint,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase" as const,
                      }}
                    >
                      {f.severity}
                    </span>
                  </div>
                  <div
                    style={{
                      marginTop: 9,
                      fontFamily: SANS,
                      fontSize: 13.5,
                      color: t.text,
                      letterSpacing: "-0.003em",
                      lineHeight: 1.35,
                    }}
                  >
                    {f.title}
                  </div>
                  {path && (
                    <div
                      style={{
                        marginTop: 4,
                        fontFamily: MONO,
                        fontSize: 11,
                        color: t.textFaint,
                      }}
                    >
                      {path}
                    </div>
                  )}
                </div>

                {/* What changed */}
                <div>
                  <UpperLabel>What changed</UpperLabel>
                  <EvidenceCell evidence={f.evidence} />
                </div>

                {/* Why risky */}
                <div>
                  <UpperLabel>Why it&apos;s risky</UpperLabel>
                  <div
                    style={{
                      fontFamily: SANS,
                      fontSize: 12.5,
                      color: t.textDim,
                      lineHeight: 1.6,
                    }}
                  >
                    {f.description}
                  </div>
                </div>

                {/* Impact */}
                <div>
                  <UpperLabel>Impact</UpperLabel>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontFamily: SANS,
                      fontSize: 12.5,
                      color: t.text,
                    }}
                  >
                    <RiskDot sev={f.severity} size={5} />
                    <span>{impactLabel(f)}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Right rail */}
      <div
        style={{
          width: 264,
          flexShrink: 0,
          borderLeft: `0.5px solid ${t.border}`,
          padding: "28px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 22,
          overflowY: "auto",
        }}
      >
        <div>
          <div
            style={{
              fontFamily: SANS,
              fontSize: 11,
              color: t.textFaint,
              letterSpacing: "0.1em",
              textTransform: "uppercase" as const,
              marginBottom: 14,
            }}
          >
            How Vigil detects these
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {[
              {
                t: "Condition operators",
                d: "Flags boundary-condition changes (≥ → ===, || → &&) that invert logic without changing test outcomes.",
              },
              {
                t: "Error handling",
                d: "Detects removed catch blocks and return-fallback → throw conversions in catch contexts.",
              },
              {
                t: "Numeric thresholds",
                d: "Catches changes to timeout, retry, limit, TTL, and other sensitivity-bearing constants.",
              },
              {
                t: "Async patterns",
                d: "Spots sequential awaits replaced by Promise.all/race/any, flagging hidden ordering dependencies.",
              },
              {
                t: "Side effects",
                d: "Identifies new browser storage and Node.js file-write operations added in this PR.",
              },
            ].map((x, i) => (
              <div key={i}>
                <div
                  style={{
                    fontFamily: SANS,
                    fontSize: 12.5,
                    color: t.text,
                    letterSpacing: "-0.003em",
                  }}
                >
                  {x.t}
                </div>
                <div
                  style={{
                    marginTop: 3,
                    fontFamily: SANS,
                    fontSize: 12,
                    color: t.textDim,
                    lineHeight: 1.55,
                  }}
                >
                  {x.d}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── SemanticTab ───────────────────────────────────────────────────────────────

type SemanticChangeType = "BEHAVIOR" | "SECURITY" | "REFACTOR";

interface SemanticChange {
  n: number;
  type: SemanticChangeType;
  file: string;
  line: number;
  removed: readonly string[];
  added: readonly string[];
  explanation: string;
  risk: string;
}

function TypeBadge({ type }: { type: SemanticChangeType }) {
  const t = TOKENS.dark;
  const color = type === "SECURITY" ? t.red : type === "BEHAVIOR" ? t.amber : t.textDim;
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 10,
        letterSpacing: "0.1em",
        color,
        border: `0.5px solid ${color}`,
        borderRadius: 3,
        padding: "1px 6px",
        flexShrink: 0,
      }}
    >
      {type}
    </span>
  );
}

const SEMANTIC_CHANGES: readonly SemanticChange[] = [
  {
    n: 1,
    type: "BEHAVIOR",
    file: "src/api/payment.ts",
    line: 13,
    removed: ["if (attempt >= retries) {"],
    added: ["if (attempt === retries) {"],
    explanation:
      "Boundary condition narrowed from ≥ to ===. The old condition fired on every attempt at or beyond the retry limit. The new condition fires only when attempt exactly equals retries — attempts beyond the limit silently bypass the block.",
    risk: "Silent behavioral change. Inputs above the threshold no longer trigger. Off-by-one risk when retries is 0 or negative.",
  },
  {
    n: 2,
    type: "BEHAVIOR",
    file: "src/api/payment.ts",
    line: 18,
    removed: ["return null;"],
    added: ["throw new PaymentError('Retry limit exceeded', 'RETRY_EXHAUSTED');"],
    explanation:
      "Error handling contract changed from returning a null fallback to throwing an exception. Callers that null-check the return value will not see the error. Callers without a surrounding try/catch will crash.",
    risk: "High. All call sites need auditing. The previous contract guaranteed a safe return value.",
  },
  {
    n: 3,
    type: "BEHAVIOR",
    file: "src/utils/retry.ts",
    line: 21,
    removed: [
      "await fn();",
      "await verify(transactionId, amount);",
      "await cleanup(transactionId);",
    ],
    added: ["await Promise.all([fn(), verify(transactionId, amount), cleanup(transactionId)]);"],
    explanation:
      "Execution order changed from sequential to parallel. If fn() must complete before verify() can check its result, or if cleanup() depends on verify() succeeding, this will produce incorrect outcomes under certain inputs.",
    risk: "Medium. Ordering dependencies not covered by existing tests may surface only under load.",
  },
  {
    n: 4,
    type: "SECURITY",
    file: "src/middleware/auth.ts",
    line: 46,
    removed: ["const decoded = jwt.decode(token);"],
    added: ["const decoded = jwt.decode(token, { algorithms: ['HS256'] });"],
    explanation:
      "Algorithm constraint added to jwt.decode() call. However, jwt.decode() never verifies the signature — it only parses the payload. This change narrows the accepted algorithm but does not validate that the token was issued by a trusted party.",
    risk: "High. A crafted token with a valid HS256 header will still pass. Use jwt.verify() with a secret to authenticate the token.",
  },
];

export function SemanticTab() {
  const t = TOKENS.dark;

  return (
    <div style={{ width: "100%", height: "100%", overflowY: "auto" }}>
      <div
        style={{
          padding: "20px 32px 16px",
          borderBottom: `0.5px solid ${t.border}`,
          display: "flex",
          alignItems: "baseline",
          gap: 20,
        }}
      >
        <div style={{ fontFamily: SANS, fontSize: 13, color: t.textDim, lineHeight: 1.55 }}>
          {SEMANTIC_CHANGES.length} semantic changes — behavioral shifts, security issues, and
          refactors grouped by intent.
        </div>
        <div style={{ flex: 1 }} />
        <span
          style={{
            fontFamily: MONO,
            fontSize: 10.5,
            color: t.textFaint,
            background: `${t.accent}14`,
            border: `0.5px solid ${t.accent}33`,
            borderRadius: 4,
            padding: "2px 8px",
          }}
        >
          AI · Claude 3.7
        </span>
      </div>

      <div style={{ padding: "0 32px 32px" }}>
        {SEMANTIC_CHANGES.map((change) => (
          <div
            key={change.n}
            style={{
              paddingTop: 28,
              paddingBottom: 28,
              borderBottom: `0.5px solid ${t.border}`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 18,
                  color: t.textFaint,
                  letterSpacing: "-0.02em",
                  lineHeight: 1,
                  minWidth: 24,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {change.n}
              </span>
              <TypeBadge type={change.type} />
              <span style={{ fontFamily: MONO, fontSize: 12, color: t.textDim }}>
                {change.file}:{change.line}
              </span>
            </div>

            <div
              style={{
                background: t.surface,
                border: `0.5px solid ${t.border}`,
                borderRadius: 6,
                overflow: "hidden",
                marginBottom: 14,
              }}
            >
              {change.removed.map((line, i) => (
                <div
                  key={`r${i}`}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 10,
                    padding: "3px 14px",
                    background: "oklch(0.32 0.05 25 / 0.32)",
                  }}
                >
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 11,
                      color: t.red,
                      flexShrink: 0,
                      minWidth: 10,
                    }}
                  >
                    −
                  </span>
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 12,
                      color: t.textDim,
                      whiteSpace: "pre" as const,
                    }}
                  >
                    {line}
                  </span>
                </div>
              ))}
              {change.added.map((line, i) => (
                <div
                  key={`a${i}`}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 10,
                    padding: "3px 14px",
                    background: "oklch(0.32 0.045 150 / 0.32)",
                  }}
                >
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 11,
                      color: t.green,
                      flexShrink: 0,
                      minWidth: 10,
                    }}
                  >
                    +
                  </span>
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 12,
                      color: t.textDim,
                      whiteSpace: "pre" as const,
                    }}
                  >
                    {line}
                  </span>
                </div>
              ))}
            </div>

            <div
              style={{
                fontFamily: SANS,
                fontSize: 13,
                color: t.text,
                lineHeight: 1.65,
                marginBottom: 10,
                maxWidth: 680,
              }}
            >
              {change.explanation}
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                fontFamily: SANS,
                fontSize: 12,
                color: change.type === "SECURITY" ? t.red : t.amber,
                lineHeight: 1.55,
              }}
            >
              <span style={{ flexShrink: 0 }}>⚠</span>
              <span>{change.risk}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── ArchTab ───────────────────────────────────────────────────────────────────

interface ArchViolation {
  file: string;
  line: number;
  layer: string;
  violation: string;
  severity: "high" | "medium" | "low";
}

const ARCH_VIOLATIONS: readonly ArchViolation[] = [
  {
    file: "src/api/payment.ts",
    line: 28,
    layer: "API",
    violation:
      "New localStorage access in an API-layer file. Browser storage is a cross-cutting concern — access should be encapsulated in a dedicated utility, not scattered across request handlers.",
    severity: "medium",
  },
  {
    file: "src/utils/retry.ts",
    line: 34,
    layer: "Service",
    violation:
      "RetryManager directly imports PaymentError from the domain layer. Utilities should not depend on domain types — invert the dependency so the caller passes an error factory.",
    severity: "medium",
  },
  {
    file: "src/middleware/auth.ts",
    line: 52,
    layer: "Utility",
    violation:
      "Auth middleware throws PaymentError (a domain-specific type). Utility-layer code should throw generic errors or accept error constructors as parameters.",
    severity: "low",
  },
];

const ARCH_LAYERS = [
  { name: "API", files: ["payment.ts"], violation: true },
  { name: "Service", files: ["retry.ts"], violation: true },
  { name: "Utility", files: ["auth.ts"], violation: true },
];

export function ArchTab() {
  const t = TOKENS.dark;

  return (
    <div style={{ width: "100%", height: "100%", overflowY: "auto" }}>
      {/* Metrics strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          borderBottom: `0.5px solid ${t.border}`,
        }}
      >
        {[
          {
            label: "Layer violations",
            value: ARCH_VIOLATIONS.length,
            note: "new in this PR",
            noteColor: t.amber,
          },
          { label: "Coupling changes", value: 2, note: "dependency edges", noteColor: t.textFaint },
          { label: "Files affected", value: 3, note: "across 3 layers", noteColor: t.textFaint },
          {
            label: "Risk level",
            value: "MED",
            note: "no critical violations",
            noteColor: t.textFaint,
          },
        ].map((m, i) => (
          <div
            key={i}
            style={{
              padding: "20px 28px",
              borderRight: i < 3 ? `0.5px solid ${t.border}` : "none",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: t.textFaint,
                letterSpacing: "0.06em",
                textTransform: "uppercase" as const,
                fontFamily: SANS,
              }}
            >
              {m.label}
            </div>
            <span
              style={{
                fontFamily: MONO,
                fontSize: 28,
                color: t.text,
                letterSpacing: "-0.02em",
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {m.value}
            </span>
            <div
              style={{
                fontFamily: MONO,
                fontSize: 11,
                color: m.noteColor,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {m.note}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 280px",
          minHeight: "calc(100% - 100px)",
        }}
      >
        {/* Main content */}
        <div
          style={{
            padding: "28px 32px",
            borderRight: `0.5px solid ${t.border}`,
            overflowY: "auto",
          }}
        >
          <UpperLabel>Layer map</UpperLabel>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginBottom: 32,
              fontFamily: MONO,
              fontSize: 12,
            }}
          >
            {ARCH_LAYERS.map((layer, i) => (
              <div key={layer.name} style={{ display: "flex", alignItems: "center" }}>
                <div
                  style={{
                    padding: "14px 20px",
                    border: `0.5px solid ${layer.violation ? t.amber : t.border}`,
                    borderRadius: 6,
                    background: layer.violation ? `${t.amber}0a` : t.surface,
                    minWidth: 120,
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase" as const,
                      color: layer.violation ? t.amber : t.textFaint,
                      marginBottom: 6,
                    }}
                  >
                    {layer.name}
                  </div>
                  {layer.files.map((f) => (
                    <div key={f} style={{ fontSize: 11, color: t.textDim }}>
                      {f}
                    </div>
                  ))}
                </div>
                {i < ARCH_LAYERS.length - 1 && (
                  <div style={{ fontSize: 16, color: t.textFaint, padding: "0 10px" }}>→</div>
                )}
              </div>
            ))}
          </div>

          <UpperLabel>Violations</UpperLabel>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {ARCH_VIOLATIONS.map((v, i) => (
              <div
                key={i}
                style={{
                  padding: "18px 0",
                  borderBottom: i < ARCH_VIOLATIONS.length - 1 ? `0.5px solid ${t.border}` : "none",
                  display: "grid",
                  gridTemplateColumns: "24px 160px 1fr",
                  gap: 16,
                  alignItems: "flex-start",
                }}
              >
                <div style={{ paddingTop: 3 }}>
                  <RiskDot sev={v.severity} size={6} />
                </div>
                <div>
                  <div
                    style={{
                      fontFamily: MONO,
                      fontSize: 11,
                      color: t.textFaint,
                      marginBottom: 6,
                    }}
                  >
                    {shortPath(v.file)}:{v.line}
                  </div>
                  <span
                    style={{
                      display: "inline-block",
                      fontFamily: MONO,
                      fontSize: 10,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase" as const,
                      color: t.textFaint,
                      border: `0.5px solid ${t.border}`,
                      borderRadius: 3,
                      padding: "1px 5px",
                    }}
                  >
                    {v.layer}
                  </span>
                </div>
                <div
                  style={{
                    fontFamily: SANS,
                    fontSize: 12.5,
                    color: t.textDim,
                    lineHeight: 1.6,
                  }}
                >
                  {v.violation}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right rail */}
        <div style={{ padding: "28px 24px", overflowY: "auto" }}>
          <div
            style={{
              fontFamily: SANS,
              fontSize: 11,
              color: t.textFaint,
              letterSpacing: "0.1em",
              textTransform: "uppercase" as const,
              marginBottom: 14,
            }}
          >
            How Vigil reads architecture
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {[
              {
                t: "API layer",
                d: "Files in src/api/ and src/routes/. Handles HTTP boundaries, request validation, and response formatting. Should not contain business logic.",
              },
              {
                t: "Service layer",
                d: "Files in src/services/, src/utils/, and retry infrastructure. Contains business rules, orchestration, and retry policies.",
              },
              {
                t: "Utility layer",
                d: "Shared helpers in src/middleware/ and src/helpers/. Should have no domain dependencies — only primitives and platform APIs.",
              },
              {
                t: "Violation heuristic",
                d: "A violation is flagged when an import, throw, or write operation crosses an expected layer boundary in the wrong direction.",
              },
            ].map((x, i) => (
              <div key={i}>
                <div
                  style={{
                    fontFamily: SANS,
                    fontSize: 12.5,
                    color: t.text,
                    letterSpacing: "-0.003em",
                  }}
                >
                  {x.t}
                </div>
                <div
                  style={{
                    marginTop: 3,
                    fontFamily: SANS,
                    fontSize: 12,
                    color: t.textDim,
                    lineHeight: 1.55,
                  }}
                >
                  {x.d}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── PlaceholderTab ────────────────────────────────────────────────────────────

const PLACEHOLDER_COPY: Partial<Record<TabId, { heading: string; body: string }>> = {
  semantic: {
    heading: "Semantic analysis",
    body: "Groups the diff into numbered semantic changes — behavior changes, refactors, and tests — with before/after code blocks and a plain-English explanation of each change's intent and risk. Requires an AI provider.",
  },
  arch: {
    heading: "Architecture drift",
    body: "Shows how this PR moves components between architectural layers, highlights cross-layer coupling violations, and recommends how to restore intended boundaries. Requires an AI provider.",
  },
};

export function PlaceholderTab({ tab }: { tab: TabId }) {
  const t = TOKENS.dark;
  const copy = PLACEHOLDER_COPY[tab];

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 48,
      }}
    >
      <div style={{ maxWidth: 400, textAlign: "center" as const }}>
        <div
          style={{
            fontFamily: SANS,
            fontSize: 15,
            fontWeight: 500,
            color: t.text,
            letterSpacing: "-0.005em",
            marginBottom: 12,
          }}
        >
          {copy?.heading ?? tab}
        </div>
        <div
          style={{
            fontFamily: SANS,
            fontSize: 13,
            color: t.textDim,
            lineHeight: 1.65,
          }}
        >
          {copy?.body ?? "Coming soon."}
        </div>
        <div
          style={{
            marginTop: 20,
            fontFamily: MONO,
            fontSize: 11,
            color: t.textFaint,
          }}
        >
          Configure an AI provider in Settings to enable this lens.
        </div>
      </div>
    </div>
  );
}
