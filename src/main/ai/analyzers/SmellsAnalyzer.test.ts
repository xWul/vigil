import { describe, expect, it } from "vitest";

import type { ReviewContext } from "../CodeAnalyzer.js";
import { SmellsAnalyzer } from "./SmellsAnalyzer.js";

function makeContext(
  files: Record<string, string>,
  status: "added" | "modified" = "added",
  hunks: { newStart: number; newCount: number }[] = [],
): ReviewContext {
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
        status,
        oldPath: null,
        newPath: path,
        hunks: hunks.map((h) => ({ ...h, oldStart: h.newStart, oldCount: h.newCount, lines: [] })),
      })),
    },
    files: new Map(Object.entries(files)),
    tokenBudget: 160_000,
  };
}

describe("SmellsAnalyzer", () => {
  const analyzer = new SmellsAnalyzer();

  it("returns no findings for a clean short function", async () => {
    const context = makeContext({
      "src/clean.ts": `function add(a: number, b: number): number { return a + b; }`,
    });
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it("flags a function with too many parameters", async () => {
    const context = makeContext({
      "src/fat.ts": `
        function create(
          name: string,
          age: number,
          email: string,
          role: string,
          active: boolean,
        ) { return { name, age, email, role, active }; }
      `,
    });
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const paramFinding = result.value.find((f) => f.title.includes("parameters"));
      expect(paramFinding).toBeDefined();
      expect(paramFinding?.source).toBe("static");
      expect(paramFinding?.pass).toBe("smells");
    }
  });

  it("flags a long function", async () => {
    const manyLines = Array.from({ length: 55 }, (_, i) => `  const x${i} = ${i};`).join("\n");
    const context = makeContext({
      "src/long.ts": `function longFn() {\n${manyLines}\n}`,
    });
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const longFinding = result.value.find((f) => f.title.includes("Long function"));
      expect(longFinding).toBeDefined();
    }
  });

  it("ignores smelly functions outside changed hunks", async () => {
    // Fat function at lines 1-10; hunk only covers line 12 (unrelated)
    const content = `function create(
  name: string, age: number, email: string, role: string, active: boolean,
) {
  return { name, age, email, role, active };
}

// unrelated
const X = 1;`;
    const context = makeContext({ "src/f.ts": content }, "modified", [
      { newStart: 8, newCount: 1 },
    ]);
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it("reports smelly functions that overlap a changed hunk", async () => {
    const content = `function create(
  name: string, age: number, email: string, role: string, active: boolean,
) {
  return { name, age, email, role, active };
}`;
    // Hunk covers line 3, which is inside the function
    const context = makeContext({ "src/f.ts": content }, "modified", [
      { newStart: 3, newCount: 2 },
    ]);
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const paramFinding = result.value.find((f) => f.title.includes("parameters"));
      expect(paramFinding).toBeDefined();
    }
  });

  it("skips non-TypeScript files", async () => {
    const context = makeContext({ "README.md": "# hello" });
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });
});
