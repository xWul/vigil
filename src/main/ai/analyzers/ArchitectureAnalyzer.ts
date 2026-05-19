import type { ResolvedAnalyzerConfig } from "../../../shared/analyzer-config.js";
import { DEFAULT_ANALYZER_CONFIG } from "../../../shared/analyzer-config.js";
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
// Layer violation detection
// ---------------------------------------------------------------------------

type Layer = "main" | "renderer" | "shared" | "preload" | "other";

const LAYER_ALLOWED: Record<Layer, ReadonlySet<Layer>> = {
  main: new Set(["main", "shared"]),
  renderer: new Set(["renderer", "shared"]),
  shared: new Set(["shared"]),
  preload: new Set(["preload", "shared"]),
  other: new Set(["main", "renderer", "shared", "preload", "other"]),
};

export function classifyLayer(filePath: string): Layer {
  if (filePath.startsWith("src/main/")) return "main";
  if (filePath.startsWith("src/renderer/")) return "renderer";
  if (filePath.startsWith("src/shared/")) return "shared";
  if (filePath.startsWith("src/preload/")) return "preload";
  return "other";
}

function layerViolationSeverity(from: Layer, to: Layer): Finding["severity"] {
  // renderer↔main crosses the Electron process boundary — hard crash in production
  if (
    (from === "renderer" && to === "main") ||
    (from === "main" && to === "renderer") ||
    from === "shared"
  ) {
    return "high";
  }
  return "medium";
}

function layerViolationDescription(from: Layer, to: Layer, fromFile: string): string {
  const name = shortName(fromFile);
  if (from === "renderer" && to === "main") {
    return `${name} imports main-process code from the renderer. The renderer is sandboxed — this import will crash at runtime in production Electron builds where processes are isolated.`;
  }
  if (from === "main" && to === "renderer") {
    return `${name} imports renderer code from the main process. Main and renderer run in separate processes; this import cannot work at runtime.`;
  }
  if (from === "shared") {
    return `${name} is a shared module but imports from the ${to} process. Shared code must be process-agnostic to remain usable in both main and renderer.`;
  }
  return `${name} (${from} layer) imports from the ${to} layer, violating the module layering rules.`;
}

// Uses a local regex instance to avoid lastIndex conflicts with the module-level RELATIVE_IMPORT_RE.
const LAYER_IMPORT_RE = /from\s+['"](\.[^'"]+)['"]/g;

export function detectLayerViolations(
  changedPaths: ReadonlySet<string>,
  files: ReadonlyMap<string, string>,
): Finding[] {
  const findings: Finding[] = [];

  for (const filePath of changedPaths) {
    const content = files.get(filePath);
    if (!content || !TS_JS.test(filePath)) continue;

    const fromLayer = classifyLayer(filePath);
    if (fromLayer === "other") continue;

    const allowed = LAYER_ALLOWED[fromLayer];
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      LAYER_IMPORT_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = LAYER_IMPORT_RE.exec(line)) !== null) {
        const importSpec = match[1]!;
        const resolved = resolveRelativeImport(filePath, importSpec);
        const toLayer = classifyLayer(resolved);
        if (toLayer === "other" || allowed.has(toLayer)) continue;

        findings.push({
          severity: layerViolationSeverity(fromLayer, toLayer),
          title: `Layer violation: ${fromLayer} imports from ${toLayer}`,
          description: layerViolationDescription(fromLayer, toLayer, filePath),
          evidence: `${line.trim()}\n${fromLayer} → ${toLayer}`,
          file: filePath,
          lines: { start: i + 1, end: i + 1 },
          pass: "architecture",
          source: "static",
        });
      }
    }
  }

  return findings;
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

type ArchitectureConfig = ResolvedAnalyzerConfig["analyzers"]["architecture"];

export class ArchitectureAnalyzer implements CodeAnalyzer {
  readonly id = "architecture" as const;
  private readonly cfg: ArchitectureConfig;

  constructor(config?: ArchitectureConfig) {
    this.cfg = config ?? DEFAULT_ANALYZER_CONFIG.analyzers.architecture;
  }

  analyze(context: ReviewContext): Promise<Result<readonly Finding[], ReviewError>> {
    if (!this.cfg.enabled) return Promise.resolve(ok([]));
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

    const findings: Finding[] = [...detectLayerViolations(changedPaths, context.files)];

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
