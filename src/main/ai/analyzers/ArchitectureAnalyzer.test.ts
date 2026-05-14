import { describe, expect, it } from "vitest";

import { ArchitectureAnalyzer, detectCycles, findImportLine } from "./ArchitectureAnalyzer.js";
import type { ReviewContext } from "../CodeAnalyzer.js";
import type { Diff, PullRequest } from "../../../shared/model/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(changedPaths: string[], fileContents: Record<string, string>): ReviewContext {
  const pr: PullRequest = {
    ref: { platform: "github", owner: "test", repo: "repo", number: 1 },
    title: "Test PR",
    body: "",
    author: { login: "user", displayName: "User" },
    state: "open",
    createdAt: new Date(),
    updatedAt: new Date(),
    url: "https://github.com/test/repo/pull/1",
    targetBranch: "main",
    sourceBranch: "feat",
    headSha: "abc123",
  };

  const diff: Diff = {
    files: changedPaths.map((p) => ({
      oldPath: p,
      newPath: p,
      status: "modified" as const,
      hunks: [],
    })),
  };

  return {
    pr,
    diff,
    files: new Map(Object.entries(fileContents)),
    tokenBudget: 160_000,
  };
}

// ---------------------------------------------------------------------------
// detectCycles
// ---------------------------------------------------------------------------

describe("detectCycles", () => {
  it("detects a direct cycle between two files", () => {
    const graph = new Map([
      ["src/a.ts", new Set(["src/b.ts"])],
      ["src/b.ts", new Set(["src/a.ts"])],
    ]);
    const cycles = detectCycles(graph);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toContain("src/a.ts");
    expect(cycles[0]).toContain("src/b.ts");
  });

  it("detects a transitive cycle A→B→C→A", () => {
    const graph = new Map([
      ["src/a.ts", new Set(["src/b.ts"])],
      ["src/b.ts", new Set(["src/c.ts"])],
      ["src/c.ts", new Set(["src/a.ts"])],
    ]);
    const cycles = detectCycles(graph);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toHaveLength(4); // A B C A
  });

  it("returns empty for a one-directional import chain", () => {
    const graph = new Map([
      ["src/a.ts", new Set(["src/b.ts"])],
      ["src/b.ts", new Set(["src/c.ts"])],
      ["src/c.ts", new Set<string>()],
    ]);
    expect(detectCycles(graph)).toHaveLength(0);
  });

  it("deduplicates the same cycle found via different entry points", () => {
    const graph = new Map([
      ["src/a.ts", new Set(["src/b.ts"])],
      ["src/b.ts", new Set(["src/a.ts"])],
      ["src/c.ts", new Set(["src/a.ts"])], // separate node pointing into the cycle
    ]);
    const cycles = detectCycles(graph);
    expect(cycles).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// findImportLine
// ---------------------------------------------------------------------------

describe("findImportLine", () => {
  it("returns the correct 1-based line number for a relative import", () => {
    const files = new Map([
      [
        "src/auth/Provider.ts",
        'import { Result } from "../../shared/result.js";\nimport { ok } from "./utils.js";\n',
      ],
      ["src/auth/utils.ts", "export const ok = true;"],
    ]);
    const result = findImportLine("src/auth/Provider.ts", "src/auth/utils.ts", files);
    expect(result).toEqual({ start: 2, end: 2 });
  });

  it("resolves .js extension to .ts source file", () => {
    const files = new Map([
      ["src/a.ts", 'import { foo } from "./b.js";\n'],
      ["src/b.ts", "export const foo = 1;"],
    ]);
    const result = findImportLine("src/a.ts", "src/b.ts", files);
    expect(result).toEqual({ start: 1, end: 1 });
  });

  it("returns null when the file is not in context", () => {
    const files = new Map([["src/b.ts", "export const foo = 1;"]]);
    expect(findImportLine("src/a.ts", "src/b.ts", files)).toBeNull();
  });

  it("returns null when the import is not found in the file", () => {
    const files = new Map([
      ["src/a.ts", 'import { foo } from "./c.js";\n'],
      ["src/b.ts", "export const foo = 1;"],
    ]);
    expect(findImportLine("src/a.ts", "src/b.ts", files)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ArchitectureAnalyzer
// ---------------------------------------------------------------------------

describe("ArchitectureAnalyzer", () => {
  const analyzer = new ArchitectureAnalyzer();

  it("returns empty findings when no TS/JS files are changed", async () => {
    const ctx = makeContext(["README.md"], { "README.md": "# Hello" });
    const result = await analyzer.analyze(ctx);
    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toHaveLength(0);
  });

  it("returns empty findings when there are no cycles", async () => {
    const ctx = makeContext(["src/a.ts"], {
      "src/a.ts": 'import { foo } from "./b.js";\n',
      "src/b.ts": "export const foo = 1;",
    });
    const result = await analyzer.analyze(ctx);
    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toHaveLength(0);
  });

  it("detects a direct cycle between two changed files", async () => {
    const ctx = makeContext(["src/a.ts", "src/b.ts"], {
      "src/a.ts": 'import { b } from "./b.js";\nexport const a = 1;\n',
      "src/b.ts": 'import { a } from "./a.js";\nexport const b = 2;\n',
    });
    const result = await analyzer.analyze(ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBeGreaterThan(0);
    expect(result.value.every((f) => f.pass === "architecture")).toBe(true);
    expect(result.value.every((f) => f.severity === "medium")).toBe(true);
    expect(result.value.every((f) => f.source === "static")).toBe(true);
  });

  it("does not report cycles involving only unchanged files", async () => {
    // Only src/c.ts is changed; the cycle is between a.ts and b.ts (unchanged)
    const ctx = makeContext(["src/c.ts"], {
      "src/a.ts": 'import { b } from "./b.js";\n',
      "src/b.ts": 'import { a } from "./a.js";\n',
      "src/c.ts": 'import { a } from "./a.js";\nexport const c = 3;\n',
    });
    const result = await analyzer.analyze(ctx);
    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toHaveLength(0);
  });

  it("anchors the finding to the changed file's import line", async () => {
    const ctx = makeContext(["src/a.ts"], {
      "src/a.ts": 'const x = 1;\nimport { b } from "./b.js";\nexport const a = 1;\n',
      "src/b.ts": 'import { a } from "./a.js";\nexport const b = 2;\n',
    });
    const result = await analyzer.analyze(ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const finding = result.value.find((f) => f.file === "src/a.ts");
    expect(finding?.lines).toEqual({ start: 2, end: 2 });
  });

  it("encodes the full cycle chain in evidence", async () => {
    const ctx = makeContext(["src/a.ts", "src/b.ts"], {
      "src/a.ts": 'import { b } from "./b.js";\n',
      "src/b.ts": 'import { a } from "./a.js";\n',
    });
    const result = await analyzer.analyze(ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const finding = result.value[0]!;
    const chain = finding.evidence.split("\n");
    expect(chain[0]).toBe(chain[chain.length - 1]); // first === last (cycle)
  });
});
