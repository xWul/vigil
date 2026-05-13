import { useState, useEffect, useMemo, useRef } from "react";

import type { PullRequest } from "../../../shared/model/index.js";
import type { ReviewResult } from "../../../shared/review.js";
import { api } from "../../api.js";
import { TOKENS, SANS, MONO, type Theme, type Tokens } from "../../shared/theme.js";
import "./ReviewQueue.css";

// ── Types ────────────────────────────────────────────────────────────────────

type RiskLevel = "high" | "med" | "low" | null;
type SortKey = "risk" | "age" | "blocking";

interface PRRow {
  pr: PullRequest;
  review: ReviewResult | null;
}

type ScreenState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; rows: PRRow[] };

const SORTS: { id: SortKey; label: string }[] = [
  { id: "risk", label: "By risk" },
  { id: "age", label: "By age" },
  { id: "blocking", label: "By blocking others" },
];

const SHORTCUTS = [
  { keys: ["↑", "↓"], label: "Move selection" },
  { keys: ["j", "k"], label: "Move selection" },
  { keys: ["↵"], label: "Open pull request" },
  { keys: ["m"], label: "Mark approved" },
  { keys: ["c"], label: "Add comment" },
  { keys: ["s"], label: "Snooze" },
  { keys: ["x"], label: "Close / dismiss" },
  { keys: ["/"], label: "Focus search" },
  { keys: ["g", "r"], label: "Re-run review" },
  { keys: ["?"], label: "Show this overlay" },
  { keys: ["Esc"], label: "Dismiss overlay" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function riskFromScore(score: 1 | 2 | 3 | 4 | 5 | null): RiskLevel {
  if (score === null) return null;
  if (score >= 4) return "high";
  if (score === 3) return "med";
  return "low";
}

function formatAge(date: Date): string {
  const mins = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function platformLabel(pr: PullRequest): string {
  return pr.ref.platform === "github" ? "GH" : "AZ";
}

function repoName(pr: PullRequest): string {
  return pr.ref.platform === "github" ? pr.ref.repo : pr.ref.repo;
}

const riskOrder: Record<string, number> = { high: 0, med: 1, low: 2 };

function ageMinutes(pr: PullRequest): number {
  return Math.floor((Date.now() - pr.createdAt.getTime()) / 60_000);
}

// ── Atoms ────────────────────────────────────────────────────────────────────

function RiskDot({ risk, t }: { risk: RiskLevel; t: Tokens }) {
  const color =
    risk === "high" ? t.red : risk === "med" ? t.amber : risk === "low" ? t.green : t.border;
  return (
    <span
      aria-label={risk ? `risk ${risk}` : "not reviewed"}
      style={{
        display: "inline-block",
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
      }}
    />
  );
}

function TrafficLights({ t }: { t: Tokens }) {
  const dot = (c: string) => (
    <span
      style={{
        width: 12,
        height: 12,
        borderRadius: "50%",
        background: c,
        display: "inline-block",
      }}
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

function Kbd({ children }: { children: React.ReactNode }) {
  return <span className="vigil-kbd">{children}</span>;
}

function Sep({ t }: { t: Tokens }) {
  return <span style={{ color: t.textFaint, padding: "0 8px" }}>·</span>;
}

// ── Header ───────────────────────────────────────────────────────────────────

function Header({
  t,
  count,
  search,
  setSearch,
  sort,
  setSort,
  searchRef,
}: {
  t: Tokens;
  count: number;
  search: string;
  setSearch: (v: string) => void;
  sort: SortKey;
  setSort: (v: SortKey) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setSortOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const sortLabel = SORTS.find((s) => s.id === sort)?.label;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "120px 1fr 180px",
        alignItems: "center",
        padding: "14px 36px 22px",
        gap: 24,
      }}
    >
      <div
        style={{
          fontFamily: SANS,
          fontSize: 14,
          fontWeight: 500,
          letterSpacing: "-0.005em",
          color: t.text,
        }}
      >
        Vigil
        <span
          style={{
            color: t.textFaint,
            marginLeft: 8,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {count}
        </span>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "7px 14px",
          borderRadius: 8,
          background: t.surface,
        }}
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0 }}>
          <circle cx="5.5" cy="5.5" r="4" stroke={t.textDim} strokeWidth="1.2" />
          <path d="M8.6 8.6l3 3" stroke={t.textDim} strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        <input
          ref={searchRef}
          className="vigil-search"
          placeholder="Search by title, repo, author…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Kbd>/</Kbd>
      </div>

      <div ref={sortRef} style={{ position: "relative", justifySelf: "end" }}>
        <button
          className="vigil-sort"
          onClick={() => setSortOpen((o) => !o)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "7px 12px",
            borderRadius: 8,
            border: 0,
            background: "transparent",
            color: t.textDim,
            fontFamily: SANS,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          <span style={{ color: t.textFaint }}>Sort</span>
          <span style={{ color: t.text }}>{sortLabel}</span>
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
            <path
              d="M1.5 3.2L4.5 6L7.5 3.2"
              stroke={t.textDim}
              strokeWidth="1.1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        {sortOpen && (
          <div
            style={{
              position: "absolute",
              top: "100%",
              right: 0,
              marginTop: 4,
              background: t.surface,
              borderRadius: 8,
              padding: 4,
              minWidth: 180,
              border: `0.5px solid ${t.border}`,
              boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
              zIndex: 5,
            }}
          >
            {SORTS.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setSort(s.id);
                  setSortOpen(false);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "7px 10px",
                  borderRadius: 6,
                  border: 0,
                  background: s.id === sort ? t.selected : "transparent",
                  color: s.id === sort ? t.text : t.textDim,
                  fontFamily: SANS,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Row ──────────────────────────────────────────────────────────────────────

function Row({
  row,
  selected,
  onClick,
  t,
}: {
  row: PRRow;
  selected: boolean;
  onClick: () => void;
  t: Tokens;
}) {
  const { pr, review } = row;
  const risk = riskFromScore(review?.riskScore ?? null);

  return (
    <div
      className={`vigil-row ${selected ? "is-selected" : ""}`}
      onClick={onClick}
      style={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: "28px 1fr auto",
        columnGap: 16,
        padding: "16px 36px",
        cursor: "default",
        background: selected ? t.selected : "transparent",
      }}
    >
      {selected && (
        <span
          style={{
            position: "absolute",
            left: 0,
            top: 8,
            bottom: 8,
            width: 2,
            background: t.accent,
            borderRadius: 2,
          }}
        />
      )}

      <div style={{ paddingTop: 7 }}>
        <RiskDot risk={risk} t={t} />
      </div>

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 12,
            color: t.text,
            fontSize: 14,
            fontWeight: 450,
            letterSpacing: "-0.005em",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{pr.title}</span>
          <span
            style={{
              fontFamily: MONO,
              fontSize: 11,
              color: t.textFaint,
              fontVariantNumeric: "tabular-nums",
              flexShrink: 0,
            }}
          >
            #{pr.ref.platform === "github" ? pr.ref.number : pr.ref.id}
          </span>
        </div>
        <div
          style={{
            marginTop: 5,
            fontFamily: MONO,
            fontSize: 11,
            color: t.textDim,
            display: "flex",
            gap: 0,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <span>{repoName(pr)}</span>
          <Sep t={t} />
          <span>{pr.author.login}</span>
          <Sep t={t} />
          <span>{platformLabel(pr)}</span>
          {review?.summary && (
            <>
              <Sep t={t} />
              <span
                style={{
                  color: t.textDim,
                  fontFamily: SANS,
                  fontSize: 12.5,
                  maxWidth: 560,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {review.summary}
              </span>
            </>
          )}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 6,
          minWidth: 64,
        }}
      >
        <span
          style={{
            fontFamily: MONO,
            fontSize: 11,
            color: t.textFaint,
            fontVariantNumeric: "tabular-nums",
            paddingTop: 2,
          }}
        >
          {formatAge(pr.createdAt)}
        </span>
        <div
          className="vigil-actions"
          style={{ display: "flex", gap: 6, opacity: 0, transition: "opacity .12s linear" }}
        >
          <Kbd>m</Kbd>
          <Kbd>c</Kbd>
          <Kbd>s</Kbd>
        </div>
      </div>
    </div>
  );
}

// ── Overlay ──────────────────────────────────────────────────────────────────

function HelpOverlay({ t, onClose }: { t: Tokens; onClose: () => void }) {
  return (
    <div
      className="vigil-help-backdrop"
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 20,
        background: "rgba(10,9,8,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 460,
          background: t.bg,
          border: `0.5px solid ${t.border}`,
          borderRadius: 12,
          padding: "28px 32px",
          fontFamily: SANS,
          color: t.text,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 22,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 500 }}>Keyboard</span>
          <span style={{ fontFamily: MONO, fontSize: 11, color: t.textFaint }}>
            press ? to toggle
          </span>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto",
            rowGap: 12,
            columnGap: 24,
          }}
        >
          {SHORTCUTS.map((s, i) => (
            <div key={i} style={{ display: "contents" }}>
              <span style={{ fontSize: 13, color: t.textDim }}>{s.label}</span>
              <span style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                {s.keys.map((k, j) => (
                  <Kbd key={j}>{k}</Kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Footer ───────────────────────────────────────────────────────────────────

function Footer({
  t,
  count,
  selectedIndex,
  syncedAt,
}: {
  t: Tokens;
  count: number;
  selectedIndex: number;
  syncedAt: Date | null;
}) {
  const syncLabel = syncedAt ? `synced ${formatAge(syncedAt)} ago` : "never synced";

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "12px 36px 14px",
        borderTop: `0.5px solid ${t.border}`,
        fontFamily: MONO,
        fontSize: 11,
        color: t.textFaint,
        fontVariantNumeric: "tabular-nums",
        flexShrink: 0,
      }}
    >
      <span>
        {count === 0 ? "0" : selectedIndex + 1}
        <span style={{ color: t.textFaint }}> of </span>
        {count}
        <span style={{ padding: "0 10px", color: t.border }}>│</span>
        <span style={{ color: t.textDim }}>GitHub</span>
        <span style={{ padding: "0 6px" }}>·</span>
        <span style={{ color: t.textDim }}>Azure DevOps</span>
        <span style={{ padding: "0 6px" }}>·</span>
        {syncLabel}
      </span>
      <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <span>↑↓ move</span>
        <span>↵ open</span>
        <Kbd>?</Kbd>
        <span>shortcuts</span>
      </span>
    </div>
  );
}

// ── Empty / Error / Loading states ───────────────────────────────────────────

function EmptyState({ t, message }: { t: Tokens; message?: string }) {
  return (
    <div
      style={{
        padding: "120px 36px",
        textAlign: "center",
        color: t.textDim,
        fontFamily: SANS,
        fontSize: 14,
        letterSpacing: "-0.005em",
      }}
    >
      {message ?? "Nothing waiting. The queue is quiet."}
    </div>
  );
}

function LoadingState({ t }: { t: Tokens }) {
  return (
    <div
      style={{
        padding: "120px 36px",
        textAlign: "center",
        color: t.textFaint,
        fontFamily: MONO,
        fontSize: 12,
      }}
    >
      Loading…
    </div>
  );
}

// ── ReviewQueue ──────────────────────────────────────────────────────────────

export function ReviewQueue({
  theme = "dark",
  onOpenSettings,
}: {
  theme?: Theme;
  onOpenSettings?: () => void;
}) {
  const t = TOKENS[theme];

  const [screen, setScreen] = useState<ScreenState>({ status: "loading" });
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("risk");
  const [selected, setSelected] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Load PRs and cached reviews on mount
  useEffect(() => {
    let mounted = true;

    async function load() {
      const listResult = await api.invoke("platform:listPRs");
      if (!mounted) return;

      if (!listResult.ok) {
        setScreen({ status: "error", message: listResult.error.code });
        return;
      }

      const prs = listResult.value;
      const reviewResults = await Promise.all(
        prs.map((pr) => api.invoke("review:getCached", pr.ref, pr.headSha)),
      );
      if (!mounted) return;

      const rows: PRRow[] = prs.map((pr, i) => {
        const rv = reviewResults[i];
        return { pr, review: rv?.ok === true ? rv.value : null };
      });

      setScreen({ status: "ready", rows });
      setSyncedAt(new Date());
    }

    void load();
    return () => {
      mounted = false;
    };
  }, []);

  const visibleRows = useMemo(() => {
    if (screen.status !== "ready") return [];

    const q = search.trim().toLowerCase();
    const filtered = q
      ? screen.rows.filter(({ pr, review }) => {
          const haystack = [
            pr.title,
            repoName(pr),
            pr.author.login,
            pr.author.displayName,
            review?.summary ?? "",
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(q);
        })
      : screen.rows.slice();

    if (sort === "risk") {
      filtered.sort((a, b) => {
        const ar = riskFromScore(a.review?.riskScore ?? null);
        const br = riskFromScore(b.review?.riskScore ?? null);
        const ao = ar !== null ? (riskOrder[ar] ?? 3) : 3;
        const bo = br !== null ? (riskOrder[br] ?? 3) : 3;
        return ao - bo || ageMinutes(b.pr) - ageMinutes(a.pr);
      });
    } else if (sort === "age") {
      filtered.sort((a, b) => ageMinutes(b.pr) - ageMinutes(a.pr));
    } else {
      // blocking: high-risk first, then by age
      filtered.sort((a, b) => {
        const ah = riskFromScore(a.review?.riskScore ?? null) === "high" ? 0 : 1;
        const bh = riskFromScore(b.review?.riskScore ?? null) === "high" ? 0 : 1;
        return ah - bh || ageMinutes(b.pr) - ageMinutes(a.pr);
      });
    }

    return filtered;
  }, [screen, search, sort]);

  // Clamp selection when list shrinks
  useEffect(() => {
    if (selected >= visibleRows.length && visibleRows.length > 0) {
      setSelected(visibleRows.length - 1);
    }
  }, [visibleRows.length, selected]);

  function onKeyDown(e: React.KeyboardEvent) {
    const inField = e.target instanceof HTMLInputElement;
    if (e.key === "?") {
      e.preventDefault();
      setHelpOpen(true);
      return;
    }
    if (e.key === "Escape") {
      setHelpOpen(false);
      searchRef.current?.blur();
      return;
    }
    if (helpOpen) return;
    if (inField) return;
    if (e.key === "/") {
      e.preventDefault();
      searchRef.current?.focus();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      setSelected((s) => Math.min(visibleRows.length - 1, s + 1));
    }
    if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      setSelected((s) => Math.max(0, s - 1));
    }
  }

  const cssVars = {
    "--v-accent": t.accent,
    "--v-accent-dim": t.accentDim,
    "--v-surface": t.surface,
    "--v-selected": t.selected,
    "--v-border": t.border,
    "--v-text": t.text,
    "--v-text-dim": t.textDim,
    "--v-text-faint": t.textFaint,
    "--v-kbd-bg": t.kbdBg,
    "--v-kbd-border": t.kbdBorder,
  } as React.CSSProperties;

  const clampedSelected = Math.max(0, Math.min(selected, visibleRows.length - 1));

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onClick={() => rootRef.current?.focus()}
      className="vigil-root"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        background: t.bg,
        color: t.text,
        display: "flex",
        flexDirection: "column",
        ...cssVars,
      }}
    >
      {/* macOS titlebar drag region */}
      <div
        style={
          {
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "12px 16px",
            height: 36,
            flexShrink: 0,
            WebkitAppRegion: "drag",
          } as React.CSSProperties
        }
      >
        <div style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <TrafficLights t={t} />
        </div>
        <div style={{ flex: 1 }} />
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            title="Settings"
            style={
              {
                WebkitAppRegion: "no-drag",
                background: "none",
                border: "none",
                padding: 4,
                cursor: "pointer",
                color: t.textFaint,
                display: "flex",
                alignItems: "center",
                borderRadius: 4,
              } as React.CSSProperties
            }
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 15 15"
              fill="currentColor"
              style={{ display: "block" }}
            >
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M7.07 0.65c-.397 0-.741.275-.829.662L6.004 2.362a5.04 5.04 0 00-.92.448L4.013 2.236a.875.875 0 00-1.054.118l-.606.606a.875.875 0 00-.118 1.054l.575.911a5.04 5.04 0 00-.449.924L1.312 6.243A.875.875 0 00.65 7.072v.857c0 .397.275.741.662.829l1.05.238c.11.379.261.74.447 1.079l-.574.911a.875.875 0 00.118 1.054l.606.606c.28.28.717.329 1.054.118l.911-.574c.339.186.7.337 1.079.447l.238 1.05c.088.387.432.662.829.662h.857c.397 0 .741-.275.829-.662l.238-1.05a5.04 5.04 0 001.079-.447l.911.574c.337.211.774.162 1.054-.118l.606-.606a.875.875 0 00.118-1.054l-.574-.911c.186-.339.337-.7.447-1.079l1.05-.238A.875.875 0 0014.35 7.93v-.857a.875.875 0 00-.662-.829l-1.05-.238a5.04 5.04 0 00-.447-1.079l.574-.911a.875.875 0 00-.118-1.054l-.606-.606a.875.875 0 00-1.054-.118l-.911.574a5.04 5.04 0 00-1.079-.447L8.757 1.312A.875.875 0 007.928.65H7.07zm.43 9.1a2.25 2.25 0 100-4.5 2.25 2.25 0 000 4.5z"
              />
            </svg>
          </button>
        )}
      </div>

      <Header
        t={t}
        count={visibleRows.length}
        search={search}
        setSearch={setSearch}
        sort={sort}
        setSort={setSort}
        searchRef={searchRef}
      />

      <div className="vigil-scroll" style={{ flex: 1, overflow: "auto", paddingBottom: 8 }}>
        {screen.status === "loading" && <LoadingState t={t} />}
        {screen.status === "error" && (
          <EmptyState t={t} message={`Failed to load PRs: ${screen.message}`} />
        )}
        {screen.status === "ready" &&
          (visibleRows.length === 0 ? (
            <EmptyState t={t} />
          ) : (
            visibleRows.map((row, i) => (
              <Row
                key={`${row.pr.ref.platform}-${row.pr.ref.platform === "github" ? row.pr.ref.number : row.pr.ref.id}`}
                row={row}
                selected={i === clampedSelected}
                onClick={() => setSelected(i)}
                t={t}
              />
            ))
          ))}
      </div>

      <Footer
        t={t}
        count={visibleRows.length}
        selectedIndex={clampedSelected}
        syncedAt={syncedAt}
      />

      {helpOpen && <HelpOverlay t={t} onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
