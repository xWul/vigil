import { describe, expect, it } from "vitest";

import type { ReviewContext } from "../CodeAnalyzer.js";
import { ComplexityAnalyzer } from "./ComplexityAnalyzer.js";

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

describe("ComplexityAnalyzer", () => {
  const analyzer = new ComplexityAnalyzer();

  it("returns no findings for a simple function", async () => {
    const context = makeContext({
      "src/simple.ts": `
        function add(a: number, b: number): number {
          return a + b;
        }
      `,
    });
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it("flags a function with high complexity", async () => {
    const complex = `
      function process(input: string): string {
        if (!input) return "";
        if (input.length > 10) {
          for (let i = 0; i < input.length; i++) {
            if (input[i] === "a") {
              while (i < input.length && input[i] === "a") i++;
            } else if (input[i] === "b") {
              for (let j = 0; j < 3; j++) {
                if (j === 0) continue;
                else if (j === 1) break;
                else return input.slice(i);
              }
            }
          }
        } else if (input.length > 5) {
          return input.toUpperCase();
        } else {
          try {
            return input.trim() || "empty";
          } catch {
            return "error";
          }
        }
        return input;
      }
    `;
    const context = makeContext({ "src/complex.ts": complex });
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBeGreaterThan(0);
      expect(result.value[0]!.source).toBe("static");
      expect(result.value[0]!.pass).toBe("complexity");
    }
  });

  it("ignores complex functions outside changed hunks", async () => {
    // Complex function at lines 1-20; hunk only covers lines 22-25 (an unrelated change)
    const complex = `function process(input: string): string {
  if (!input) return "";
  if (input.length > 10) {
    for (let i = 0; i < input.length; i++) {
      if (input[i] === "a") {
        while (i < input.length && input[i] === "a") i++;
      } else if (input[i] === "b") {
        for (let j = 0; j < 3; j++) {
          if (j === 0) continue;
          else if (j === 1) break;
        }
      }
    }
  } else if (input.length > 5) {
    return input.toUpperCase();
  } else {
    try { return input.trim(); } catch { return "error"; }
  }
  return input;
}
// unrelated change below
const VERSION = "2";`;
    const context = makeContext({ "src/f.ts": complex }, "modified", [
      { newStart: 22, newCount: 1 },
    ]);
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it("reports complex functions that overlap a changed hunk", async () => {
    const complex = `function process(input: string): string {
  if (!input) return "";
  if (input.length > 10) {
    for (let i = 0; i < input.length; i++) {
      if (input[i] === "a") {
        while (i < input.length && input[i] === "a") i++;
      } else if (input[i] === "b") {
        for (let j = 0; j < 3; j++) {
          if (j === 0) continue;
          else if (j === 1) break;
        }
      }
    }
  } else if (input.length > 5) {
    return input.toUpperCase();
  } else {
    try { return input.trim(); } catch { return "error"; }
  }
  return input;
}`;
    // Hunk covers line 5 which is inside the function
    const context = makeContext({ "src/f.ts": complex }, "modified", [
      { newStart: 5, newCount: 3 },
    ]);
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.length).toBeGreaterThan(0);
  });

  it("does not count branches of nested functions toward outer function complexity", async () => {
    // outer() has 1 branch; inner arrow function has 11+ branches — without the fix,
    // outer would be reported as high-complexity due to inner's branches.
    const code = `
      function outer(x: number): number {
        const inner = (n: number): boolean => {
          if (n > 0) return true;
          if (n < -10) return false;
          if (n < -9) return false;
          if (n < -8) return false;
          if (n < -7) return false;
          if (n < -6) return false;
          if (n < -5) return false;
          if (n < -4) return false;
          if (n < -3) return false;
          if (n < -2) return false;
          return n === 0;
        };
        if (x > 0) return x;
        return -x;
      }
    `;
    const context = makeContext({ "src/nested.ts": code });
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const outerFinding = result.value.find((f) => f.title.includes('"outer"'));
      expect(outerFinding).toBeUndefined();
      const innerFinding = result.value.find((f) => f.title.includes('"inner"'));
      expect(innerFinding).toBeDefined();
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

  it("skips non-TypeScript files", async () => {
    const context = makeContext({ "README.md": "# hello" });
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });
});
