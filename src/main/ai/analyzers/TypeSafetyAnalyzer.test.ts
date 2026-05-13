import { describe, expect, it } from "vitest";

import type { DiffLine, FileDiff } from "../../platforms/model/index.js";
import type { ReviewContext } from "../CodeAnalyzer.js";
import { TypeSafetyAnalyzer } from "./TypeSafetyAnalyzer.js";

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

describe("TypeSafetyAnalyzer", () => {
  const analyzer = new TypeSafetyAnalyzer();

  it("returns no findings for clean added lines", async () => {
    const context = makeContext([makeFile("src/foo.ts", [makeLine("const x: string = 'hello';")])]);
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it("flags as any at medium severity", async () => {
    const context = makeContext([makeFile("src/foo.ts", [makeLine("const x = value as any;")])]);
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.severity).toBe("medium");
      expect(result.value[0]?.pass).toBe("type-safety");
    }
  });

  it("flags as unknown as at medium severity", async () => {
    const context = makeContext([
      makeFile("src/foo.ts", [makeLine("const x = value as unknown as Foo;")]),
    ]);
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.severity).toBe("medium");
    }
  });

  it("flags @ts-ignore at medium severity", async () => {
    const context = makeContext([makeFile("src/foo.ts", [makeLine("// @ts-ignore")])]);
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]?.severity).toBe("medium");
  });

  it("flags @ts-expect-error at info severity", async () => {
    const context = makeContext([makeFile("src/foo.ts", [makeLine("// @ts-expect-error")])]);
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]?.severity).toBe("info");
  });

  it("flags non-null assertion before member access at low severity", async () => {
    const context = makeContext([makeFile("src/foo.ts", [makeLine("const y = value!.name;")])]);
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.severity).toBe("low");
    }
  });

  it("flags non-null assertion before semicolon", async () => {
    const context = makeContext([makeFile("src/foo.ts", [makeLine("doThing(value!);")])]);
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it("does not flag legitimate as narrowing", async () => {
    const context = makeContext([makeFile("src/foo.ts", [makeLine('const m = "POST" as const;')])]);
    const result = await analyzer.analyze(context);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it("does not flag patterns in removed or context lines", async () => {
    const context = makeContext([
      makeFile("src/foo.ts", [
        makeLine("const x = old as any;", "removed"),
        makeLine("// @ts-ignore existing", "context"),
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
});
