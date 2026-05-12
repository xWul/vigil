import { describe, expect, it } from "vitest";

import type { ReviewContext } from "../CodeAnalyzer.js";
import { DuplicationAnalyzer } from "./DuplicationAnalyzer.js";

function makeContext(files: Record<string, string>): ReviewContext {
  return {
    pr: {
      ref: { platform: "github", owner: "a", repo: "b", number: 1 },
      title: "test",
      body: "",
      author: { displayName: "x", login: "x" },
      state: "open",
      createdAt: new Date(),
      updatedAt: new Date(),
      url: "",
      targetBranch: "main",
      sourceBranch: "feat",
      headSha: "abc",
    },
    diff: {
      files: Object.keys(files).map((path) => ({
        status: "modified" as const,
        oldPath: null,
        newPath: path,
        hunks: [],
      })),
    },
    files: new Map(Object.entries(files)),
    tokenBudget: 160_000,
  };
}

const DUPLICATED_BLOCK = `
  const result = items
    .filter((item) => item.active)
    .map((item) => item.name)
    .sort((a, b) => a.localeCompare(b))
    .join(", ");
  return result;
`.trim();

describe("DuplicationAnalyzer", () => {
  const analyzer = new DuplicationAnalyzer();

  it("returns no findings for unique code", async () => {
    const context = makeContext({
      "src/a.ts": "export function foo() { return 1; }",
      "src/b.ts": "export function bar() { return 2; }",
    });
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it("detects duplicated blocks across files", async () => {
    const context = makeContext({
      "src/a.ts": DUPLICATED_BLOCK,
      "src/b.ts": DUPLICATED_BLOCK,
    });
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBeGreaterThan(0);
      expect(result.value[0]!.pass).toBe("duplication");
      expect(result.value[0]!.source).toBe("static");
    }
  });

  it("skips deleted files", async () => {
    const context: ReviewContext = {
      ...makeContext({}),
      diff: {
        files: [{ status: "deleted", oldPath: "src/gone.ts", newPath: "src/gone.ts", hunks: [] }],
      },
    };
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });
});
