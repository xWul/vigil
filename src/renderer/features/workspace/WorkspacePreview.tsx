import type { Diff, FileDiff, PullRequest } from "../../../shared/model/index.js";
import type { Finding, ReviewResult } from "../../../shared/review.js";
import type { IpcEvents } from "../../../shared/ipc-contract.js";
import type { Settings } from "../../../shared/settings.js";
import type { ConnectedAccount } from "../../../shared/auth.js";
import { _overrideApi } from "../../api.js";
import { WorkspaceScreen } from "./WorkspaceScreen.js";

// ── Mock PR ───────────────────────────────────────────────────────────────────

const MOCK_PR: PullRequest = {
  ref: { platform: "github", owner: "acmecorp", repo: "payments-service", number: 2847 },
  title: "refactor: migrate payment processor to async queue pipeline",
  body: "Migrates synchronous payment calls to an async queue for better throughput. Also pulls user data fetches into parallel.",
  author: { displayName: "Wesley Moura", login: "xWul" },
  state: "open",
  createdAt: new Date(Date.now() - 6 * 3_600_000),
  updatedAt: new Date(Date.now() - 45 * 60_000),
  url: "https://github.com/acmecorp/payments-service/pull/2847",
  targetBranch: "main",
  sourceBranch: "feat/async-payment-queue",
  headSha: "a1b2c3d4e5f6789a",
};

// ── Mock accounts ─────────────────────────────────────────────────────────────

const MOCK_ACCOUNT: ConnectedAccount = {
  platform: "github",
  displayName: "Wesley Moura",
  login: "xWul",
};

const MOCK_ACCOUNTS: readonly ConnectedAccount[] = [MOCK_ACCOUNT];

// ── Mock queue PRs ────────────────────────────────────────────────────────────

const MOCK_PR2: PullRequest = {
  ref: { platform: "github", owner: "acmecorp", repo: "analytics-service", number: 1204 },
  title: "feat: add funnel conversion tracking to checkout events",
  body: "",
  author: { displayName: "Wesley Moura", login: "xWul" },
  state: "open",
  createdAt: new Date(Date.now() - 2 * 24 * 3_600_000),
  updatedAt: new Date(Date.now() - 3 * 3_600_000),
  url: "https://github.com/acmecorp/analytics-service/pull/1204",
  targetBranch: "main",
  sourceBranch: "feat/funnel-tracking",
  headSha: "b2c3d4e5f6789ab0",
};

const MOCK_PR3: PullRequest = {
  ref: { platform: "github", owner: "acmecorp", repo: "user-service", number: 893 },
  title: "chore: update dependency versions, bump Node to 22 LTS",
  body: "",
  author: { displayName: "Wesley Moura", login: "xWul" },
  state: "open",
  createdAt: new Date(Date.now() - 5 * 24 * 3_600_000),
  updatedAt: new Date(Date.now() - 12 * 3_600_000),
  url: "https://github.com/acmecorp/user-service/pull/893",
  targetBranch: "main",
  sourceBranch: "chore/deps-node22",
  headSha: "c3d4e5f6789ab0c1",
};

const MOCK_PR4: PullRequest = {
  ref: {
    platform: "azure-devops",
    org: "acmecorp",
    project: "Platform",
    repo: "api-gateway",
    id: 2103,
  },
  title: "fix: handle edge case in request deduplication logic",
  body: "",
  author: { displayName: "Wesley Moura", login: "xWul" },
  state: "open",
  createdAt: new Date(Date.now() - 1 * 24 * 3_600_000),
  updatedAt: new Date(Date.now() - 2 * 3_600_000),
  url: "https://dev.azure.com/acmecorp/Platform/_git/api-gateway/pullrequest/2103",
  targetBranch: "main",
  sourceBranch: "fix/dedup-edge-case",
  headSha: "d4e5f6789ab0c1d2",
};

const MOCK_PRS: readonly PullRequest[] = [MOCK_PR, MOCK_PR2, MOCK_PR3, MOCK_PR4];

const MOCK_REVIEW_PR2: ReviewResult = {
  findings: [],
  summary:
    "Funnel event schema looks consistent with the existing analytics contracts. Two minor style suggestions on event naming.",
  riskScore: 2,
};

const MOCK_REVIEW_PR3: ReviewResult = {
  findings: [],
  summary: "Dependency updates look clean. No behavioral changes detected.",
  riskScore: 1,
};

// ── Mock diff ─────────────────────────────────────────────────────────────────

const paymentFile: FileDiff = {
  status: "modified",
  oldPath: "src/api/payment.ts",
  newPath: "src/api/payment.ts",
  hunks: [
    {
      oldStart: 10,
      oldCount: 13,
      newStart: 10,
      newCount: 14,
      lines: [
        { kind: "context", content: "const MIN_TRANSACTION = 0.01;", oldLine: 10, newLine: 10 },
        { kind: "context", content: "", oldLine: 11, newLine: 11 },
        {
          kind: "context",
          content: "export async function processPayment(amount: number, userId: string) {",
          oldLine: 12,
          newLine: 12,
        },
        {
          kind: "removed",
          content: "  if (amount >= MIN_TRANSACTION) {",
          oldLine: 13,
          newLine: null,
        },
        {
          kind: "added",
          content: "  if (amount === MIN_TRANSACTION) {",
          oldLine: null,
          newLine: 13,
        },
        { kind: "context", content: "    try {", oldLine: 14, newLine: 14 },
        {
          kind: "context",
          content: "      const result = await chargeCard(userId, amount);",
          oldLine: 15,
          newLine: 15,
        },
        {
          kind: "context",
          content: "      return { success: true, transactionId: result.id };",
          oldLine: 16,
          newLine: 16,
        },
        { kind: "context", content: "    } catch (err) {", oldLine: 17, newLine: 17 },
        {
          kind: "removed",
          content: '      return { success: false, error: "charge_failed" };',
          oldLine: 18,
          newLine: null,
        },
        {
          kind: "added",
          content: '      throw new Error("charge_failed");',
          oldLine: null,
          newLine: 18,
        },
        { kind: "context", content: "    }", oldLine: 19, newLine: 19 },
        { kind: "context", content: "  }", oldLine: 20, newLine: 20 },
        {
          kind: "added",
          content: '  localStorage.setItem("lastPayment", JSON.stringify({ userId, amount }));',
          oldLine: null,
          newLine: 21,
        },
        {
          kind: "context",
          content: '  return { success: false, error: "below_minimum" };',
          oldLine: 21,
          newLine: 22,
        },
        { kind: "context", content: "}", oldLine: 22, newLine: 23 },
      ],
    },
  ],
};

const retryFile: FileDiff = {
  status: "modified",
  oldPath: "src/utils/retry.ts",
  newPath: "src/utils/retry.ts",
  hunks: [
    {
      oldStart: 6,
      oldCount: 3,
      newStart: 6,
      newCount: 3,
      lines: [
        { kind: "context", content: "const INITIAL_DELAY_MS = 100;", oldLine: 6, newLine: 6 },
        { kind: "removed", content: "const MAX_RETRIES = 3;", oldLine: 7, newLine: null },
        { kind: "added", content: "const MAX_RETRIES = 10;", oldLine: null, newLine: 7 },
        { kind: "context", content: "const BASE_TIMEOUT_MS = 3000;", oldLine: 8, newLine: 8 },
      ],
    },
    {
      oldStart: 19,
      oldCount: 7,
      newStart: 19,
      newCount: 7,
      lines: [
        { kind: "context", content: "", oldLine: 19, newLine: 19 },
        {
          kind: "context",
          content: "export async function fetchUserData(userId: string) {",
          oldLine: 20,
          newLine: 20,
        },
        {
          kind: "removed",
          content: "  const profile = await fetchProfile(userId);",
          oldLine: 21,
          newLine: null,
        },
        {
          kind: "removed",
          content: "  const settings = await fetchSettings(userId);",
          oldLine: 22,
          newLine: null,
        },
        {
          kind: "removed",
          content: "  const permissions = await fetchPermissions(userId);",
          oldLine: 23,
          newLine: null,
        },
        {
          kind: "added",
          content: "  const [profile, settings, permissions] = await Promise.all([",
          oldLine: null,
          newLine: 21,
        },
        {
          kind: "added",
          content: "    fetchProfile(userId), fetchSettings(userId), fetchPermissions(userId),",
          oldLine: null,
          newLine: 22,
        },
        { kind: "added", content: "  ]);", oldLine: null, newLine: 23 },
        {
          kind: "context",
          content: "  return { profile, settings, permissions };",
          oldLine: 24,
          newLine: 24,
        },
        { kind: "context", content: "}", oldLine: 25, newLine: 25 },
      ],
    },
  ],
};

const authFile: FileDiff = {
  status: "modified",
  oldPath: "src/middleware/auth.ts",
  newPath: "src/middleware/auth.ts",
  hunks: [
    {
      oldStart: 44,
      oldCount: 6,
      newStart: 44,
      newCount: 7,
      lines: [
        {
          kind: "context",
          content: "export function validateToken(token: string): User | null {",
          oldLine: 44,
          newLine: 44,
        },
        { kind: "context", content: "  if (!token) return null;", oldLine: 45, newLine: 45 },
        {
          kind: "removed",
          content: "  const decoded = jwt.decode(token);",
          oldLine: 46,
          newLine: null,
        },
        {
          kind: "added",
          content: "  const decoded = jwt.decode(token, { complete: true });",
          oldLine: null,
          newLine: 46,
        },
        { kind: "added", content: "  if (!decoded) return null;", oldLine: null, newLine: 47 },
        {
          kind: "context",
          content: "  const { userId, exp } = decoded as { userId: string; exp: number };",
          oldLine: 47,
          newLine: 48,
        },
        {
          kind: "context",
          content: "  if (exp < Date.now() / 1000) return null;",
          oldLine: 48,
          newLine: 49,
        },
        {
          kind: "context",
          content: "  return userCache.get(userId) ?? null;",
          oldLine: 49,
          newLine: 50,
        },
      ],
    },
  ],
};

const MOCK_DIFF: Diff = { files: [paymentFile, retryFile, authFile] };

// ── Mock findings ─────────────────────────────────────────────────────────────

const MOCK_FINDINGS: readonly Finding[] = [
  // Regression — condition operator
  {
    pass: "regression",
    source: "static",
    severity: "high",
    file: "src/api/payment.ts",
    lines: { start: 13, end: 13 },
    title: "Condition operator changed: >= → ===",
    description:
      "The old condition accepted any amount at or above MIN_TRANSACTION. The new condition only accepts amounts exactly equal to MIN_TRANSACTION. Any payment above the minimum will now silently fall through to the 'below_minimum' error path.",
    evidence: "- if (amount >= MIN_TRANSACTION) {\n+ if (amount === MIN_TRANSACTION) {",
  },
  // Regression — error handling
  {
    pass: "regression",
    source: "static",
    severity: "high",
    file: "src/api/payment.ts",
    lines: { start: 18, end: 18 },
    title: "Error handling changed: now throws instead of returning fallback",
    description:
      "A catch block that previously returned a safe fallback value now throws. Callers that do not handle this error will crash. Check all sites that call processPayment — they likely handle the Result shape, not exceptions.",
    evidence:
      '- return { success: false, error: "charge_failed" };\n+ throw new Error("charge_failed");',
  },
  // Regression — side effect
  {
    pass: "regression",
    source: "static",
    severity: "medium",
    file: "src/api/payment.ts",
    lines: { start: 21, end: 21 },
    title: "New side effect: localStorage write",
    description:
      "Payment data (userId and amount) is now persisted to localStorage on every failed transaction. Consider the privacy implications of storing payment metadata in browser storage, and whether this data needs an expiry policy.",
    evidence: '+ localStorage.setItem("lastPayment", JSON.stringify({ userId, amount }));',
  },
  // Regression — numeric threshold
  {
    pass: "regression",
    source: "static",
    severity: "medium",
    file: "src/utils/retry.ts",
    lines: { start: 7, end: 7 },
    title: "Retry value changed: 3 → 10",
    description:
      "MAX_RETRIES increased 3.3×. Under sustained failure, operations will now retry up to 10 times before giving up. This increases the maximum wait time and may cause cascading load on the downstream service during outages.",
    evidence: "- const MAX_RETRIES = 3;\n+ const MAX_RETRIES = 10;",
  },
  // Regression — async pattern
  {
    pass: "regression",
    source: "static",
    severity: "medium",
    file: "src/utils/retry.ts",
    lines: { start: 21, end: 23 },
    title: "Sequential await replaced by Promise.all",
    description:
      "Execution order changed from sequential to parallel. Verify there are no ordering dependencies between fetchProfile, fetchSettings, and fetchPermissions. If any of these calls fails, Promise.all rejects immediately — ensure callers handle partial failures.",
    evidence:
      "- const profile = await fetchProfile(userId);\n- const settings = await fetchSettings(userId);\n- const permissions = await fetchPermissions(userId);\n+ const [profile, settings, permissions] = await Promise.all([",
  },
  // Security — AI finding
  {
    pass: "security",
    source: "ai",
    severity: "high",
    file: "src/middleware/auth.ts",
    lines: { start: 46, end: 46 },
    title: "JWT decoded without signature verification",
    description:
      "jwt.decode() only parses the payload — it does not verify the signature. Use jwt.verify() with the signing secret to ensure the token was issued by a trusted authority. An attacker can craft any payload and it will pass this check.",
    evidence:
      "- const decoded = jwt.decode(token);\n+ const decoded = jwt.decode(token, { complete: true });",
  },
  // Correctness — AI finding
  {
    pass: "correctness",
    source: "ai",
    severity: "medium",
    file: "src/middleware/auth.ts",
    lines: { start: 48, end: 48 },
    title: "Decoded JWT payload cast without schema validation",
    description:
      "The payload is cast directly to `{ userId: string; exp: number }` without runtime validation. If the token is missing these fields, accessing userId will silently return undefined and userCache.get(undefined) will return null — but the function signature promises User | null, not a crash.",
    evidence: "  const { userId, exp } = decoded as { userId: string; exp: number };",
  },
  // Consistency — PR-level AI finding (no line)
  {
    pass: "consistency",
    source: "ai",
    severity: "medium",
    file: "src/api/payment.ts",
    lines: null,
    title: "Inconsistent error handling across service boundaries",
    description:
      "payment.ts now throws on charge failure while the rest of the service layer returns Result objects. This mixes two error-handling conventions in the same layer. Standardise on one pattern — callers of processPayment will need to wrap it in a try/catch where they currently expect a Result.",
    evidence: "",
  },
  // Architecture — direct circular dependency
  {
    pass: "architecture",
    source: "static",
    severity: "medium",
    file: "src/api/payment.ts",
    lines: { start: 3, end: 3 },
    title: "Circular import: api/payment.ts ↔ middleware/auth.ts",
    description:
      "api/payment.ts participates in a circular dependency. Circular imports can cause initialization-order bugs and make dependency relationships hard to reason about.",
    evidence: "src/api/payment.ts\nsrc/middleware/auth.ts\nsrc/api/payment.ts",
  },
  // Architecture — three-hop cycle
  {
    pass: "architecture",
    source: "static",
    severity: "medium",
    file: "src/utils/retry.ts",
    lines: { start: 2, end: 2 },
    title: "Circular import: utils/retry.ts → middleware/auth.ts → api/payment.ts → utils/retry.ts",
    description:
      "utils/retry.ts participates in a circular dependency. Circular imports can cause initialization-order bugs and make dependency relationships hard to reason about.",
    evidence: "src/utils/retry.ts\nsrc/middleware/auth.ts\nsrc/api/payment.ts\nsrc/utils/retry.ts",
  },
];

const MOCK_REVIEW_RESULT: ReviewResult = {
  findings: MOCK_FINDINGS,
  summary:
    "This PR introduces several high-risk behavioral changes alongside the async migration. The condition operator change in processPayment will silently break payments above the minimum threshold. The JWT change adds a null-guard but still does not verify the signature.",
  riskScore: 4,
};

const MOCK_SETTINGS: Settings = {
  aiProvider: "anthropic",
  model: "claude-opus-4-5",
  logLevel: "info",
  hasAnthropicKey: true,
  hasOpenAIKey: false,
};

// ── Mock API factory ──────────────────────────────────────────────────────────

interface MockRendererApi {
  invoke(channel: string, ..._args: readonly unknown[]): Promise<unknown>;
  on(channel: string, handler: (payload: unknown) => void): () => void;
}

function createMockApi(): MockRendererApi {
  const listeners = new Map<string, Set<(p: unknown) => void>>();

  function emit<K extends keyof IpcEvents>(channel: K, payload: IpcEvents[K]) {
    listeners.get(channel)?.forEach((h) => h(payload));
  }

  return {
    invoke(channel, ...args) {
      switch (channel) {
        // Auth
        case "auth:signIn":
          return new Promise((resolve) =>
            setTimeout(() => resolve({ ok: true, value: MOCK_ACCOUNT }), 1_200),
          );
        case "auth:getAccounts":
          return Promise.resolve({ ok: true, value: MOCK_ACCOUNTS });
        case "auth:signOut":
          return Promise.resolve({ ok: true, value: undefined });

        // Queue
        case "platform:listPRs":
          return new Promise((resolve) =>
            setTimeout(() => resolve({ ok: true, value: MOCK_PRS }), 400),
          );
        case "review:getCached": {
          // Return appropriate cached result per PR headSha
          const headSha = (args as [unknown, string])[1];
          if (headSha === MOCK_PR.headSha) {
            return Promise.resolve({ ok: true, value: MOCK_REVIEW_RESULT });
          }
          if (headSha === MOCK_PR2.headSha) {
            return Promise.resolve({ ok: true, value: MOCK_REVIEW_PR2 });
          }
          if (headSha === MOCK_PR3.headSha) {
            return Promise.resolve({ ok: true, value: MOCK_REVIEW_PR3 });
          }
          return Promise.resolve({ ok: true, value: null }); // PR4 not reviewed
        }

        // Workspace
        case "platform:getPRWithDiff":
          return Promise.resolve({ ok: true, value: { pr: MOCK_PR, diff: MOCK_DIFF } });
        case "settings:get":
          return Promise.resolve({ ok: true, value: MOCK_SETTINGS });
        case "review:run":
          return Promise.resolve({ ok: true, value: MOCK_REVIEW_RESULT });
        case "platform:submitReview":
          return new Promise((resolve) =>
            setTimeout(() => resolve({ ok: true, value: undefined }), 700),
          );
        case "review:challenge": {
          // Simulate a streaming response with realistic text
          const chunks = [
            "Good catch. The boundary condition change means ",
            "only transactions with `amount` ",
            "exactly equal to `MIN_TRANSACTION` ",
            "will proceed — any value above the minimum ",
            "will fall through to the `below_minimum` ",
            "error path and silently fail. ",
            "Check the payment gateway logs to see ",
            "if existing traffic includes amounts above 0.01 — ",
            "if so, this change would immediately start ",
            "dropping real transactions.",
          ];
          chunks.forEach((token, i) => {
            setTimeout(
              () => emit("review:challengeChunk", { token, done: i === chunks.length - 1 }),
              350 + i * 75,
            );
          });
          return Promise.resolve({ ok: true, value: undefined });
        }
        default:
          return Promise.resolve({ ok: true, value: undefined });
      }
    },

    on(channel, handler) {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel)!.add(handler);
      return () => {
        listeners.get(channel)?.delete(handler);
      };
    },
  };
}

// ── Module-level mock installation ───────────────────────────────────────────
//
// Installed once at module load time so the mock is active before any component
// effect runs. React Strict Mode re-runs effects bottom-up (children first), so
// a useEffect-based approach would let WorkspaceScreen call the real IPC bridge
// on the strict-mode re-run. Module-level installation has no such race.
//
// Only active when this module is imported, which only happens when the app is
// started with VITE_MOCK=1 (pnpm dev:mock).

if (import.meta.env.VITE_MOCK === "1") {
  _overrideApi(createMockApi() as Parameters<typeof _overrideApi>[0]);
}

// ── WorkspacePreview ──────────────────────────────────────────────────────────

export function WorkspacePreview({ onBack }: { onBack: () => void }) {
  return <WorkspaceScreen pr={MOCK_PR} onBack={onBack} />;
}
