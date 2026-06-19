import { describe, expect, it } from "vitest";

import type { DiffLine, FileDiff } from "../../platforms/model/index.js";
import type { ReviewContext } from "../CodeAnalyzer.js";
import { DebugArtifactsAnalyzer } from "./DebugArtifactsAnalyzer.js";

function makeLine(content: string, kind: DiffLine["kind"] = "added", newLine = 1): DiffLine {
  return {
    kind,
    content,
    oldLine: kind === "added" ? null : 1,
    newLine: kind === "removed" ? null : newLine,
  };
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
    hunks: [{ oldStart: 1, oldCount: lines.length, newStart: 1, newCount: lines.length, lines }],
  };
}

function makeContext(files: FileDiff[]): ReviewContext {
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
    diff: { files },
    files: new Map(),
    tokenBudget: 160_000,
  };
}

describe("DebugArtifactsAnalyzer", () => {
  const analyzer = new DebugArtifactsAnalyzer();

  it("returns no findings for clean added lines", async () => {
    const context = makeContext([makeFile("src/foo.ts", [makeLine("const x = 1;")])]);
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it("flags console.log in an added line", async () => {
    const context = makeContext([
      makeFile("src/foo.ts", [makeLine("  console.log(x);", "added", 5)]),
    ]);
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.pass).toBe("debug-artifacts");
      expect(result.value[0]?.severity).toBe("low");
      expect(result.value[0]?.lines).toEqual({ start: 5, end: 5 });
    }
  });

  it("flags all console variants", async () => {
    const variants = ["console.error(e)", "console.warn(w)", "console.debug(d)", "console.info(i)"];
    for (const v of variants) {
      const context = makeContext([makeFile("src/foo.ts", [makeLine(v)])]);
      const result = await analyzer.analyze(context);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toHaveLength(1);
    }
  });

  it("flags debugger at medium severity", async () => {
    const context = makeContext([makeFile("src/foo.ts", [makeLine("  debugger;")])]);
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0]?.severity).toBe("medium");
    }
  });

  it("flags TODO and FIXME at info severity", async () => {
    for (const marker of [
      "// TODO: fix this",
      "// FIXME handle edge case",
      "// HACK workaround",
      "// XXX",
    ]) {
      const context = makeContext([makeFile("src/foo.ts", [makeLine(marker)])]);
      const result = await analyzer.analyze(context);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.severity).toBe("info");
      }
    }
  });

  it("does not flag console.log in removed or context lines", async () => {
    const context = makeContext([
      makeFile("src/foo.ts", [
        makeLine("console.log('old')", "removed"),
        makeLine("console.log('ctx')", "context"),
      ]),
    ]);
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it("returns no findings for an empty diff", async () => {
    const context = makeContext([]);
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it("does not flag console.log in a Python file", async () => {
    const context = makeContext([makeFile("src/service.py", [makeLine("  console.log(x);")])]);
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it("flags print() in a Python file", async () => {
    const context = makeContext([
      makeFile("src/service.py", [makeLine('  print("debug value:", x)', "added", 3)]),
    ]);
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.severity).toBe("low");
      expect(result.value[0]?.lines).toEqual({ start: 3, end: 3 });
    }
  });

  it("does not flag print() in a TypeScript file", async () => {
    const context = makeContext([makeFile("src/foo.ts", [makeLine("  print(x);")])]);
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value.filter((f) => f.title === "Debug print call")).toHaveLength(0);
  });

  it("flags System.out.println in a Java file", async () => {
    const context = makeContext([
      makeFile("src/Service.java", [makeLine('    System.out.println("debug");')]),
    ]);
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.some((f) => f.title === "Debug print call")).toBe(true);
    }
  });

  it("flags Console.WriteLine in a C# file", async () => {
    const context = makeContext([
      makeFile("src/Service.cs", [makeLine('    Console.WriteLine("debug");')]),
    ]);
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.some((f) => f.title === "Debug print call")).toBe(true);
    }
  });

  it("flags fmt.Println in a Go file", async () => {
    const context = makeContext([makeFile("src/service.go", [makeLine('  fmt.Println("debug")')])]);
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.some((f) => f.title === "Debug print call")).toBe(true);
    }
  });

  it("flags TODO/FIXME in a Python file (universal patterns)", async () => {
    const context = makeContext([makeFile("src/service.py", [makeLine("  # TODO: fix this")])]);
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.some((f) => f.severity === "info")).toBe(true);
    }
  });
});
