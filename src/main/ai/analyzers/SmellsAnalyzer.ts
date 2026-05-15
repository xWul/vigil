import ts from "typescript";

import type { ResolvedAnalyzerConfig } from "../../../shared/analyzer-config.js";
import { DEFAULT_ANALYZER_CONFIG } from "../../../shared/analyzer-config.js";
import { ok } from "../../../shared/result.js";
import type { Result } from "../../../shared/result.js";
import type { CodeAnalyzer, Finding, ReviewContext, ReviewError } from "../CodeAnalyzer.js";

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"]);

function isAnalyzable(path: string): boolean {
  const ext = path.slice(path.lastIndexOf("."));
  return TS_EXTENSIONS.has(ext);
}

function getFunctionName(node: ts.FunctionLikeDeclaration, sourceFile: ts.SourceFile): string {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text;
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const parent = node.parent;
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
      return parent.name.text;
    }
  }
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
  return `function at line ${line + 1}`;
}

function countMaxNesting(node: ts.Node): number {
  let max = 0;

  function visit(n: ts.Node, depth: number): void {
    if (
      ts.isBlock(n) ||
      ts.isIfStatement(n) ||
      ts.isForStatement(n) ||
      ts.isForOfStatement(n) ||
      ts.isForInStatement(n) ||
      ts.isWhileStatement(n) ||
      ts.isDoStatement(n) ||
      ts.isTryStatement(n)
    ) {
      max = Math.max(max, depth);
      ts.forEachChild(n, (child) => visit(child, depth + 1));
    } else {
      ts.forEachChild(n, (child) => visit(child, depth));
    }
  }

  ts.forEachChild(node, (child) => visit(child, 0));
  return max;
}

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isConstructorDeclaration(node)
  );
}

interface LineRange {
  start: number;
  end: number;
}

function overlapsAnyRange(
  funcStart: number,
  funcEnd: number,
  ranges: readonly LineRange[],
): boolean {
  return ranges.some((r) => funcStart <= r.end && funcEnd >= r.start);
}

type SmellsConfig = ResolvedAnalyzerConfig["analyzers"]["smells"];

function analyzeFile(
  filePath: string,
  content: string,
  changedRanges?: readonly LineRange[],
  cfg: SmellsConfig = DEFAULT_ANALYZER_CONFIG.analyzers.smells,
): Finding[] {
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  const findings: Finding[] = [];

  function visit(node: ts.Node): void {
    if (isFunctionLike(node)) {
      const startPos = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      const endPos = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
      const funcStart = startPos.line + 1;
      const funcEnd = endPos.line + 1;

      if (!changedRanges || overlapsAnyRange(funcStart, funcEnd, changedRanges)) {
        const name = getFunctionName(node, sourceFile);
        const lineCount = funcEnd - funcStart + 1;
        const paramCount = node.parameters.length;
        const nestingDepth = countMaxNesting(node);
        const firstLine =
          content.slice(node.getStart(), node.getStart() + 120).split("\n")[0] ?? "";

        if (lineCount > cfg.maxFunctionLines) {
          findings.push({
            severity: "low",
            title: `Long function "${name}" (${lineCount} lines)`,
            description: `"${name}" spans ${lineCount} lines, exceeding the ${cfg.maxFunctionLines}-line guideline. Long functions are harder to read, test, and maintain. Consider splitting it into smaller, focused functions.`,
            evidence: firstLine,
            file: filePath,
            lines: { start: funcStart, end: funcEnd },
            pass: "smells",
            source: "static",
          });
        }

        if (paramCount > cfg.maxParams) {
          findings.push({
            severity: "low",
            title: `Too many parameters in "${name}" (${paramCount})`,
            description: `"${name}" has ${paramCount} parameters. Functions with more than ${cfg.maxParams} parameters are hard to call correctly. Consider grouping related parameters into an options object.`,
            evidence: firstLine,
            file: filePath,
            lines: { start: funcStart, end: funcStart },
            pass: "smells",
            source: "static",
          });
        }

        if (nestingDepth > cfg.maxNesting) {
          findings.push({
            severity: "low",
            title: `Deep nesting in "${name}" (depth ${nestingDepth})`,
            description: `"${name}" has a maximum nesting depth of ${nestingDepth}. Deeply nested code is hard to follow. Consider early returns, guard clauses, or extracting nested logic into helper functions.`,
            evidence: firstLine,
            file: filePath,
            lines: { start: funcStart, end: funcStart },
            pass: "smells",
            source: "static",
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  ts.forEachChild(sourceFile, visit);
  return findings;
}

export class SmellsAnalyzer implements CodeAnalyzer {
  readonly id = "smells" as const;
  private readonly cfg: SmellsConfig;

  constructor(config?: SmellsConfig) {
    this.cfg = config ?? DEFAULT_ANALYZER_CONFIG.analyzers.smells;
  }

  analyze(context: ReviewContext): Promise<Result<readonly Finding[], ReviewError>> {
    if (!this.cfg.enabled) return Promise.resolve(ok([]));

    const findings: Finding[] = [];

    for (const file of context.diff.files) {
      if (file.status === "deleted") continue;
      if (!isAnalyzable(file.newPath)) continue;

      const content = context.files.get(file.newPath);
      if (!content) continue;

      if (file.status === "added") {
        findings.push(...analyzeFile(file.newPath, content, undefined, this.cfg));
      } else {
        const changedRanges = file.hunks.map((h) => ({
          start: h.newStart,
          end: h.newStart + h.newCount - 1,
        }));
        findings.push(...analyzeFile(file.newPath, content, changedRanges, this.cfg));
      }
    }

    return Promise.resolve(ok(findings));
  }
}
