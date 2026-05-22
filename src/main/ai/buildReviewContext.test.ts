import { describe, expect, it } from "vitest";

import { collectImportCandidates, resolveRelativeImport } from "./buildReviewContext.js";

// ── resolveRelativeImport ─────────────────────────────────────────────────────

describe("resolveRelativeImport", () => {
  it("resolves a sibling import", () => {
    expect(resolveRelativeImport("src/main/ai/foo.ts", "./bar.ts")).toBe("src/main/ai/bar.ts");
  });

  it("resolves a parent-directory import", () => {
    expect(resolveRelativeImport("src/main/ai/foo.ts", "../utils/helper.ts")).toBe(
      "src/main/utils/helper.ts",
    );
  });

  it("resolves a two-level parent import", () => {
    expect(resolveRelativeImport("src/main/ai/foo.ts", "../../shared/result.js")).toBe(
      "src/shared/result.ts",
    );
  });

  it("swaps .js extension to .ts", () => {
    expect(resolveRelativeImport("src/main/foo.ts", "./bar.js")).toBe("src/main/bar.ts");
  });

  it("swaps .jsx extension to .tsx", () => {
    expect(resolveRelativeImport("src/renderer/App.tsx", "./Button.jsx")).toBe(
      "src/renderer/Button.tsx",
    );
  });

  it("preserves .ts extension as-is", () => {
    expect(resolveRelativeImport("src/main/foo.ts", "./bar.ts")).toBe("src/main/bar.ts");
  });

  it("handles a file at the root of the repo", () => {
    expect(resolveRelativeImport("index.ts", "./lib.js")).toBe("lib.ts");
  });
});

// ── collectImportCandidates ───────────────────────────────────────────────────

describe("collectImportCandidates", () => {
  it("extracts relative imports from a TS file", () => {
    const files = new Map([
      [
        "src/main/ai/foo.ts",
        `import { ok } from "../../shared/result.js";\nimport { bar } from "./bar.js";`,
      ],
    ]);
    const candidates = collectImportCandidates(files);
    expect(candidates).toContain("src/shared/result.ts");
    expect(candidates).toContain("src/main/ai/bar.ts");
  });

  it("skips absolute / package imports", () => {
    const files = new Map([
      ["src/main/foo.ts", `import React from "react";\nimport { x } from "@scope/pkg";`],
    ]);
    expect(collectImportCandidates(files)).toHaveLength(0);
  });

  it("skips non-TS/JS files", () => {
    const files = new Map([
      ["src/styles.css", `/* @import "./tokens.css"; */`],
      ["src/README.md", `import { foo } from "./bar.js"`],
    ]);
    expect(collectImportCandidates(files)).toHaveLength(0);
  });

  it("excludes paths already present in the map", () => {
    const files = new Map([
      ["src/main/foo.ts", `import { ok } from "./result.js";`],
      ["src/main/result.ts", `export const ok = () => {};`],
    ]);
    const candidates = collectImportCandidates(files);
    expect(candidates).not.toContain("src/main/result.ts");
  });

  it("deduplicates imports referenced by multiple changed files", () => {
    // Files 3 levels deep so ../../ resolves correctly to src/shared/
    const files = new Map([
      ["src/main/ai/a.ts", `import { ok } from "../../shared/result.js";`],
      ["src/main/ai/b.ts", `import { err } from "../../shared/result.js";`],
    ]);
    const candidates = collectImportCandidates(files);
    const resultCount = candidates.filter((p) => p === "src/shared/result.ts").length;
    expect(resultCount).toBe(1);
  });

  it("returns an empty list when no relative imports exist", () => {
    const files = new Map([["src/main/foo.ts", `const x = 1;`]]);
    expect(collectImportCandidates(files)).toHaveLength(0);
  });
});
