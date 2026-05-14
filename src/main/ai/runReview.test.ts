import { describe, expect, it, vi } from "vitest";

import { ok } from "../../shared/result.js";
import type { AIProvider, AIRequest } from "./AIProvider.js";
import type { CodeAnalyzer, Finding, ReviewContext } from "./CodeAnalyzer.js";
import { runReview } from "./runReview.js";

const BASE_CONTEXT: ReviewContext = {
  pr: {
    ref: { platform: "github", owner: "a", repo: "b", number: 1 },
    title: "Test PR",
    body: "test body",
    author: { displayName: "alice", login: "alice" },
    state: "open",
    createdAt: new Date(),
    updatedAt: new Date(),
    url: "https://github.com/a/b/pull/1",
    targetBranch: "main",
    sourceBranch: "feat",
    headSha: "abc123",
  },
  diff: { files: [] },
  files: new Map(),
  tokenBudget: 160_000,
};

function yieldOnce(text: string): AsyncIterable<string> {
  // eslint-disable-next-line @typescript-eslint/require-await
  return (async function* () {
    yield text;
  })();
}

function makeAIProvider(responses: string[]): AIProvider {
  let callIndex = 0;
  return {
    id: "anthropic",
    stream(_req: AIRequest): AsyncIterable<string> {
      const response = responses[callIndex++] ?? "[]";
      return yieldOnce(response);
    },
  };
}

function makeAnalyzer(
  id: "complexity" | "duplication" | "smells",
  findings: Finding[],
): CodeAnalyzer {
  return {
    id,
    analyze: vi.fn().mockResolvedValue(ok(findings)),
  };
}

const STATIC_FINDING: Finding = {
  severity: "low",
  title: "Static finding",
  description: "desc",
  evidence: "code",
  file: "src/foo.ts",
  lines: { start: 1, end: 5 },
  pass: "complexity",
  source: "static",
};

describe("runReview", () => {
  it("returns static findings when no AI provider", async () => {
    const analyzer = makeAnalyzer("complexity", [STATIC_FINDING]);
    const result = await runReview(BASE_CONTEXT, [analyzer], null, { model: "unused" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.findings).toHaveLength(1);
      expect(result.value.summary).toBe("");
      expect(result.value.riskScore).toBeNull();
    }
  });

  it("runs all analyzers in parallel and merges findings", async () => {
    const a1 = makeAnalyzer("complexity", [STATIC_FINDING]);
    const a2 = makeAnalyzer("smells", [{ ...STATIC_FINDING, pass: "smells" }]);
    const result = await runReview(BASE_CONTEXT, [a1, a2], null, { model: "unused" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.findings).toHaveLength(2);
  });

  it("swallows analyzer failures and continues", async () => {
    const failingAnalyzer: CodeAnalyzer = {
      id: "complexity",
      analyze: vi.fn().mockRejectedValue(new Error("oops")),
    };
    const goodAnalyzer = makeAnalyzer("smells", [STATIC_FINDING]);
    const result = await runReview(BASE_CONTEXT, [failingAnalyzer, goodAnalyzer], null, {
      model: "unused",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.findings).toHaveLength(1);
  });

  it("merges AI findings with static findings", async () => {
    const aiFinding = JSON.stringify([
      {
        severity: "high",
        title: "AI finding",
        description: "desc",
        evidence: "code",
        file: "src/foo.ts",
        lines: { start: 10, end: 12 },
      },
    ]);
    const summaryResponse = JSON.stringify({
      summary: "Looks good overall.",
      riskScore: 2,
    });
    const provider = makeAIProvider([aiFinding, aiFinding, aiFinding, summaryResponse]);
    const analyzer = makeAnalyzer("complexity", [STATIC_FINDING]);

    const result = await runReview(BASE_CONTEXT, [analyzer], provider, {
      model: "claude-sonnet-4-6",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.findings.length).toBeGreaterThan(1);
      expect(result.value.summary).toBe("Looks good overall.");
      expect(result.value.riskScore).toBe(2);
    }
  });

  it("skips an AI pass on model_error and continues", async () => {
    const badJson = "not json";
    const summaryResponse = JSON.stringify({ summary: "done", riskScore: 1 });
    const provider = makeAIProvider([badJson, badJson, "[]", "[]", "[]", summaryResponse]);

    const result = await runReview(BASE_CONTEXT, [], provider, { model: "claude-sonnet-4-6" });
    expect(result.ok).toBe(true);
  });

  it("returns summary with null riskScore on summary parse failure", async () => {
    const emptyFindings = "[]";
    const provider = makeAIProvider([emptyFindings, emptyFindings, emptyFindings, "not json"]);
    const result = await runReview(BASE_CONTEXT, [], provider, { model: "claude-sonnet-4-6" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.riskScore).toBeNull();
      expect(result.value.summary).toBe("");
    }
  });
});
