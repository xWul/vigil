import { ok } from "../../../shared/result.js";
import type { Result } from "../../../shared/result.js";
import type { CodeAnalyzer, Finding, ReviewContext, ReviewError } from "../CodeAnalyzer.js";
import { resolveRelativeImport } from "../buildReviewContext.js";

const TS_JS = /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/;
const RELATIVE_IMPORT_RE = /from\s+['"](\.[^'"]+)['"]/g;

// ---------------------------------------------------------------------------
// Import graph
// ---------------------------------------------------------------------------

function buildImportGraph(files: ReadonlyMap<string, string>): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();

  for (const filePath of files.keys()) {
    if (!graph.has(filePath)) graph.set(filePath, new Set());
  }

  for (const [filePath, content] of files) {
    if (!TS_JS.test(filePath)) continue;
    RELATIVE_IMPORT_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = RELATIVE_IMPORT_RE.exec(content)) !== null) {
      const resolved = resolveRelativeImport(filePath, match[1]!);
      if (files.has(resolved)) {
        graph.get(filePath)!.add(resolved);
      }
    }
  }

  return graph;
}

// ---------------------------------------------------------------------------
// Cycle detection (DFS)
// ---------------------------------------------------------------------------

function normalizeCycle(cycle: string[]): string {
  const n = cycle.length - 1; // last element repeats first
  let min = 0;
  for (let i = 1; i < n; i++) {
    if ((cycle[i] ?? "") < (cycle[min] ?? "")) min = i;
  }
  const rotated = [...cycle.slice(min, n), ...cycle.slice(0, min), cycle[min]!];
  return rotated.join("|");
}

export function detectCycles(graph: Map<string, Set<string>>): string[][] {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const stackOrder: string[] = [];
  const cycles: string[][] = [];
  const seen = new Set<string>();

  function dfs(node: string): void {
    visited.add(node);
    recursionStack.add(node);
    stackOrder.push(node);

    for (const neighbor of graph.get(node) ?? []) {
      if (!visited.has(neighbor)) {
        dfs(neighbor);
      } else if (recursionStack.has(neighbor)) {
        // Found a back edge — extract the cycle path
        const cycleStart = stackOrder.indexOf(neighbor);
        const cycle = [...stackOrder.slice(cycleStart), neighbor];
        const key = normalizeCycle(cycle);
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(cycle);
        }
      }
    }

    stackOrder.pop();
    recursionStack.delete(node);
  }

  for (const node of graph.keys()) {
    if (!visited.has(node)) dfs(node);
  }

  return cycles;
}

// ---------------------------------------------------------------------------
// Line number lookup
// ---------------------------------------------------------------------------

export function findImportLine(
  filePath: string,
  targetPath: string,
  files: ReadonlyMap<string, string>,
): { start: number; end: number } | null {
  const content = files.get(filePath);
  if (!content) return null;

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    RELATIVE_IMPORT_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = RELATIVE_IMPORT_RE.exec(line)) !== null) {
      const resolved = resolveRelativeImport(filePath, match[1]!);
      if (resolved === targetPath) {
        const lineNum = i + 1;
        return { start: lineNum, end: lineNum };
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Finding construction
// ---------------------------------------------------------------------------

function shortName(filePath: string): string {
  const parts = filePath.split("/");
  return parts.length <= 2 ? filePath : parts.slice(-2).join("/");
}

function buildTitle(cycle: string[]): string {
  const n = cycle.length - 1; // exclude the repeated tail
  if (n === 2) {
    return `Circular import: ${shortName(cycle[0]!)} ↔ ${shortName(cycle[1]!)}`;
  }
  return `Circular import: ${cycle.slice(0, n).map(shortName).join(" → ")}`;
}

// ---------------------------------------------------------------------------
// Analyzer
// ---------------------------------------------------------------------------

export class ArchitectureAnalyzer implements CodeAnalyzer {
  readonly id = "architecture" as const;

  analyze(context: ReviewContext): Promise<Result<readonly Finding[], ReviewError>> {
    const changedPaths = new Set(
      context.diff.files.filter((f) => TS_JS.test(f.newPath)).map((f) => f.newPath),
    );

    if (changedPaths.size === 0) {
      return Promise.resolve(ok([]));
    }

    const graph = buildImportGraph(context.files);
    const cycles = detectCycles(graph);

    // Keep only cycles that touch at least one changed file
    const relevantCycles = cycles.filter((cycle) => cycle.some((file) => changedPaths.has(file)));

    const findings: Finding[] = [];

    for (const cycle of relevantCycles) {
      const chain = cycle.join("\n");
      const title = buildTitle(cycle);
      const n = cycle.length - 1;

      for (let i = 0; i < n; i++) {
        const file = cycle[i]!;
        if (!changedPaths.has(file)) continue;

        const nextFile = cycle[i + 1]!;
        const lines = findImportLine(file, nextFile, context.files);

        findings.push({
          severity: "medium",
          title,
          description: `${shortName(file)} participates in a circular dependency. Circular imports can cause initialization-order bugs and make dependency relationships hard to reason about.`,
          evidence: chain,
          file,
          lines,
          pass: "architecture",
          source: "static",
        });
      }
    }

    return Promise.resolve(ok(findings));
  }
}
