import { describe, expect, it } from "vitest";

import type { DiffLine, FileDiff } from "../../platforms/model/index.js";
import type { ReviewContext } from "../CodeAnalyzer.js";
import { SilentRegressionAnalyzer } from "./SilentRegressionAnalyzer.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function removed(content: string, oldLine = 1): DiffLine {
  return { kind: "removed", content, oldLine, newLine: null };
}

function added(content: string, newLine = 2): DiffLine {
  return { kind: "added", content, oldLine: null, newLine };
}

function context(content: string): DiffLine {
  return { kind: "context", content, oldLine: 1, newLine: 1 };
}

function makeFile(path: string, lines: DiffLine[], status: FileDiff["status"] = "modified"): FileDiff {
  return {
    status,
    oldPath: null,
    newPath: path,
    hunks: lines.length > 0
      ? [{ oldStart: 1, oldCount: lines.length, newStart: 1, newCount: lines.length, lines }]
      : [],
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

const analyzer = new SilentRegressionAnalyzer();

// ---------------------------------------------------------------------------
// General
// ---------------------------------------------------------------------------

describe("SilentRegressionAnalyzer", () => {
  it("returns no findings for a clean diff", async () => {
    const ctx = makeContext([makeFile("src/foo.ts", [context("const x = 1;")])]);
    const result = await analyzer.analyze(ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it("skips deleted files", async () => {
    const ctx = makeContext([makeFile("src/foo.ts", [], "deleted")]);
    const result = await analyzer.analyze(ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it("skips non-TS/JS files", async () => {
    const ctx = makeContext([makeFile("README.md", [added("if (attempt >= retries) {")])]);
    const result = await analyzer.analyze(ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Detector 1: Condition operator changes
// ---------------------------------------------------------------------------

describe("detectConditionChanges", () => {
  it("flags >= changed to === in an if condition", async () => {
    const ctx = makeContext([makeFile("src/foo.ts", [
      removed("  if (attempt >= retries) {"),
      added("  if (attempt === retries) {"),
    ])]);
    const result = await analyzer.analyze(ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const f = result.value.find((x) => x.title.includes(">="));
      expect(f).toBeDefined();
      expect(f?.severity).toBe("high");
      expect(f?.pass).toBe("regression");
    }
  });

  it("flags || changed to && in an if condition", async () => {
    const ctx = makeContext([makeFile("src/foo.ts", [
      removed("  if (a || b) {"),
      added("  if (a && b) {"),
    ])]);
    const result = await analyzer.analyze(ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.some((f) => f.title.includes("||"))).toBe(true);
    }
  });

  it("does not flag when no conditional marker present", async () => {
    const ctx = makeContext([makeFile("src/foo.ts", [
      removed('const label = count >= 10 ? "many" : "few";'),
      added('const label = count === 10 ? "many" : "few";'),
    ])]);
    // ternary with ? and : IS a conditional marker — this should trigger
    const result = await analyzer.analyze(ctx);
    expect(result.ok).toBe(true);
    // ternary line has ' ? ' and ' : ' so it should fire
    if (result.ok) {
      expect(result.value.some((f) => f.pass === "regression")).toBe(true);
    }
  });

  it("does not flag when lines are too structurally different", async () => {
    const ctx = makeContext([makeFile("src/foo.ts", [
      removed("  if (attempt >= retries) {"),
      added("  while (queue.length > 0 && !done) {"),
    ])]);
    const result = await analyzer.analyze(ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.filter((f) => f.title.includes(">="))).toHaveLength(0);
    }
  });

  it("does not flag operator changes outside conditional context", async () => {
    const ctx = makeContext([makeFile("src/foo.ts", [
      removed("const ok = x >= 0;"),
      added("const ok = x === 0;"),
    ])]);
    const result = await analyzer.analyze(ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.filter((f) => f.title.includes(">="))).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Detector 2: Error handling
// ---------------------------------------------------------------------------

describe("detectErrorHandlingChanges", () => {
  it("flags a removed catch block", async () => {
    const ctx = makeContext([makeFile("src/foo.ts", [
      removed("  } catch (e) {"),
      removed("    return null;"),
      removed("  }"),
    ])]);
    const result = await analyzer.analyze(ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const f = result.value.find((x) => x.title === "Catch block removed");
      expect(f).toBeDefined();
      expect(f?.severity).toBe("high");
    }
  });

  it("does not flag a catch block that was rewritten (still present in added lines)", async () => {
    const ctx = makeContext([makeFile("src/foo.ts", [
      removed("  } catch (e) {"),
      removed("    return null;"),
      removed("  }"),
      added("  } catch (err) {"),
      added("    logger.error(err);"),
      added("  }"),
    ])]);
    const result = await analyzer.analyze(ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.find((x) => x.title === "Catch block removed")).toBeUndefined();
    }
  });

  it("flags return null → throw in catch context", async () => {
    const ctx = makeContext([makeFile("src/foo.ts", [
      context("  } catch (e) {"),
      removed("    return null;"),
      added("    throw e;"),
      context("  }"),
    ])]);
    const result = await analyzer.analyze(ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const f = result.value.find((x) => x.title.includes("throws"));
      expect(f).toBeDefined();
      expect(f?.severity).toBe("high");
    }
  });

  it("does not flag throw outside catch context", async () => {
    const ctx = makeContext([makeFile("src/foo.ts", [
      removed("  return null;"),
      added("  throw new Error('oops');"),
    ])]);
    const result = await analyzer.analyze(ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.find((x) => x.title.includes("throws"))).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Detector 3: Numeric constant changes
// ---------------------------------------------------------------------------

describe("detectNumericChanges", () => {
  it("flags a timeout value change", async () => {
    const ctx = makeContext([makeFile("src/foo.ts", [
      removed("  timeout: 3000,"),
      added("  timeout: 10000,"),
    ])]);
    const result = await analyzer.analyze(ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const f = result.value.find((x) => x.title.includes("Timeout"));
      expect(f).toBeDefined();
      expect(f?.severity).toBe("medium");
      expect(f?.title).toContain("3000 → 10000");
    }
  });

  it("flags a retry count change", async () => {
    const ctx = makeContext([makeFile("src/foo.ts", [
      removed("  maxRetries: 3,"),
      added("  maxRetries: 10,"),
    ])]);
    const result = await analyzer.analyze(ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.some((f) => f.title.includes("3 → 10"))).toBe(true);
    }
  });

  it("does not flag numeric changes without sensitivity keyword", async () => {
    const ctx = makeContext([makeFile("src/foo.ts", [
      removed("  const VERSION = 1;"),
      added("  const VERSION = 2;"),
    ])]);
    const result = await analyzer.analyze(ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.filter((f) => f.pass === "regression" && f.title.includes("→"))).toHaveLength(0);
    }
  });

  it("does not flag when the number is unchanged", async () => {
    const ctx = makeContext([makeFile("src/foo.ts", [
      removed("  timeout: 3000, // old comment"),
      added("  timeout: 3000, // new comment"),
    ])]);
    const result = await analyzer.analyze(ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.filter((f) => f.title.includes("Timeout"))).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Detector 4: Async pattern changes
// ---------------------------------------------------------------------------

describe("detectAsyncPatternChanges", () => {
  it("flags sequential awaits replaced by Promise.all", async () => {
    const ctx = makeContext([makeFile("src/foo.ts", [
      removed("  const a = await fetchA();"),
      removed("  const b = await fetchB();"),
      added("  const [a, b] = await Promise.all([fetchA(), fetchB()]);"),
    ])]);
    const result = await analyzer.analyze(ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const f = result.value.find((x) => x.title.includes("Promise.all"));
      expect(f).toBeDefined();
      expect(f?.severity).toBe("medium");
    }
  });

  it("flags Promise.allSettled with its specific semantics", async () => {
    const ctx = makeContext([makeFile("src/foo.ts", [
      removed("  await doA();"),
      removed("  await doB();"),
      added("  await Promise.allSettled([doA(), doB()]);"),
    ])]);
    const result = await analyzer.analyze(ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.some((f) => f.title.includes("Promise.allSettled"))).toBe(true);
    }
  });

  it("does not flag when only one await was removed", async () => {
    const ctx = makeContext([makeFile("src/foo.ts", [
      removed("  const a = await fetchA();"),
      added("  const a = await Promise.all([fetchA()]);"),
    ])]);
    const result = await analyzer.analyze(ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.filter((f) => f.title.includes("Promise"))).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Detector 5: Side effect introductions
// ---------------------------------------------------------------------------

describe("detectSideEffectIntroductions", () => {
  it("flags a new localStorage access", async () => {
    const ctx = makeContext([makeFile("src/foo.ts", [
      added('  localStorage.setItem("key", value);', 10),
    ])]);
    const result = await analyzer.analyze(ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const f = result.value.find((x) => x.title.includes("localStorage"));
      expect(f).toBeDefined();
      expect(f?.severity).toBe("medium");
      expect(f?.lines).toEqual({ start: 10, end: 10 });
    }
  });

  it("flags a new fs.writeFile call", async () => {
    const ctx = makeContext([makeFile("src/main/foo.ts", [
      added("  await fs.writeFile(path, data);"),
    ])]);
    const result = await analyzer.analyze(ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.some((f) => f.title.includes("file write"))).toBe(true);
    }
  });

  it("flags a new document.cookie access", async () => {
    const ctx = makeContext([makeFile("src/foo.ts", [
      added('  document.cookie = "session=abc";'),
    ])]);
    const result = await analyzer.analyze(ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.some((f) => f.title.includes("cookie"))).toBe(true);
    }
  });

  it("does not flag side effects in removed lines", async () => {
    const ctx = makeContext([makeFile("src/foo.ts", [
      removed('  localStorage.setItem("key", value);'),
    ])]);
    const result = await analyzer.analyze(ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.filter((f) => f.title.includes("localStorage"))).toHaveLength(0);
    }
  });
});
