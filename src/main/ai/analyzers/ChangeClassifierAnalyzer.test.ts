import { describe, expect, it } from "vitest";

import type { DiffLine, FileDiff } from "../../platforms/model/index.js";
import type { ReviewContext } from "../CodeAnalyzer.js";
import { ChangeClassifierAnalyzer } from "./ChangeClassifierAnalyzer.js";

function makeLine(content: string, kind: DiffLine["kind"] = "added"): DiffLine {
  return { kind, content, oldLine: kind === "added" ? null : 1, newLine: kind === "removed" ? null : 1 };
}

function makeFile(
  path: string,
  lines: DiffLine[],
  status: FileDiff["status"] = "modified",
): FileDiff {
  return {
    status,
    oldPath: null,
    newPath: path,
    hunks:
      lines.length > 0
        ? [{ oldStart: 1, oldCount: lines.length, newStart: 1, newCount: lines.length, lines }]
        : [],
  };
}

function makeContext(files: FileDiff[], prTitle = "feat: add feature"): ReviewContext {
  return {
    pr: {
      ref: { platform: "github", owner: "a", repo: "b", number: 1 },
      title: prTitle,
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
    diff: { files },
    files: new Map(),
    tokenBudget: 160_000,
  };
}

describe("ChangeClassifierAnalyzer", () => {
  const analyzer = new ChangeClassifierAnalyzer();

  it("always emits a change summary finding", async () => {
    const context = makeContext([]);
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const summary = result.value.find((f) => f.title.startsWith("Change breakdown"));
      expect(summary).toBeDefined();
      expect(summary?.severity).toBe("info");
      expect(summary?.pass).toBe("change-classification");
      expect(summary?.source).toBe("static");
      expect(summary?.file).toBe("");
      expect(summary?.lines).toBeNull();
    }
  });

  it("classifies a test file correctly", async () => {
    const context = makeContext([makeFile("src/foo.test.ts", [makeLine("expect(1).toBe(1);")])]);
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const summary = result.value.find((f) => f.title.startsWith("Change breakdown"));
      expect(summary?.title).toContain("1 test");
      expect(summary?.title).not.toContain("behavior");
    }
  });

  it("classifies a config file correctly", async () => {
    for (const path of ["package.json", "vitest.config.ts.yaml", "README.md"]) {
      const context = makeContext([makeFile(path, [makeLine('{ "name": "vigil" }')])]);
      const result = await analyzer.analyze(context);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const summary = result.value.find((f) => f.title.startsWith("Change breakdown"));
        expect(summary?.title).toContain("config");
      }
    }
  });

  it("classifies a file with control-flow in added lines as behavior", async () => {
    const context = makeContext([
      makeFile("src/foo.ts", [makeLine("if (x > 0) {")]),
    ]);
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const summary = result.value.find((f) => f.title.startsWith("Change breakdown"));
      expect(summary?.title).toContain("1 behavior");
      expect(summary?.description).toContain("src/foo.ts");
    }
  });

  it("classifies a file with control-flow in removed lines as behavior", async () => {
    const context = makeContext([
      makeFile("src/foo.ts", [makeLine("return old;", "removed")]),
    ]);
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const summary = result.value.find((f) => f.title.startsWith("Change breakdown"));
      expect(summary?.title).toContain("behavior");
    }
  });

  it("classifies a file without control-flow as refactor", async () => {
    const context = makeContext([
      makeFile("src/foo.ts", [makeLine("const newName = value;")]),
    ]);
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const summary = result.value.find((f) => f.title.startsWith("Change breakdown"));
      expect(summary?.title).toContain("refactor-only");
      expect(summary?.title).not.toContain("behavior");
    }
  });

  it("does not classify control-flow in context lines as behavior", async () => {
    const context = makeContext([
      makeFile("src/foo.ts", [makeLine("if (unchanged) {", "context")]),
    ]);
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const summary = result.value.find((f) => f.title.startsWith("Change breakdown"));
      expect(summary?.title).not.toContain("behavior");
    }
  });

  it("classifies a deleted non-test non-config file as behavior", async () => {
    const context = makeContext([makeFile("src/module.ts", [], "deleted")]);
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const summary = result.value.find((f) => f.title.startsWith("Change breakdown"));
      expect(summary?.title).toContain("behavior");
    }
  });

  it("classifies a deleted test file as test", async () => {
    const context = makeContext([makeFile("src/module.test.ts", [], "deleted")]);
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const summary = result.value.find((f) => f.title.startsWith("Change breakdown"));
      expect(summary?.title).toContain("test");
      expect(summary?.title).not.toContain("behavior");
    }
  });

  it("classifies a renamed file with no hunks as refactor", async () => {
    const renamedFile: FileDiff = {
      status: "renamed",
      oldPath: "src/old.ts",
      newPath: "src/new.ts",
      hunks: [],
    };
    const context = makeContext([renamedFile]);
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const summary = result.value.find((f) => f.title.startsWith("Change breakdown"));
      expect(summary?.title).toContain("refactor-only");
    }
  });

  it("does not emit intent mismatch for a non-refactor title", async () => {
    const context = makeContext(
      [makeFile("src/foo.ts", [makeLine("if (x) {")])],
      "feat: add new feature",
    );
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const mismatch = result.value.find((f) => f.title.includes("Intent mismatch"));
      expect(mismatch).toBeUndefined();
    }
  });

  it("emits intent mismatch when refactor title has behavior changes", async () => {
    const context = makeContext(
      [makeFile("src/foo.ts", [makeLine("return newValue;")])],
      "refactor: rename helpers",
    );
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const mismatch = result.value.find((f) => f.title.includes("Intent mismatch"));
      expect(mismatch).toBeDefined();
      expect(mismatch?.severity).toBe("medium");
      expect(mismatch?.evidence).toBe("refactor: rename helpers");
    }
  });

  it("detects all intent keywords", async () => {
    const titles = ["chore: cleanup", "rename types", "tidy up imports", "cleanup dead code"];
    for (const title of titles) {
      const context = makeContext(
        [makeFile("src/foo.ts", [makeLine("if (x) {")])],
        title,
      );
      const result = await analyzer.analyze(context);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const mismatch = result.value.find((f) => f.title.includes("Intent mismatch"));
        expect(mismatch).toBeDefined();
      }
    }
  });

  it("does not emit intent mismatch when there are no behavior files", async () => {
    const context = makeContext(
      [makeFile("src/foo.test.ts", [makeLine("expect(1).toBe(1);")])],
      "refactor: restructure tests",
    );
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const mismatch = result.value.find((f) => f.title.includes("Intent mismatch"));
      expect(mismatch).toBeUndefined();
    }
  });
});
