import { describe, expect, it } from "vitest";

import type { ReviewContext } from "../CodeAnalyzer.js";
import { ComplexityAnalyzer } from "./ComplexityAnalyzer.js";

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
