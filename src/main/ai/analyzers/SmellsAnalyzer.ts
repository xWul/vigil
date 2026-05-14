import ts from "typescript";

import { ok } from "../../../shared/result.js";
import type { Result } from "../../../shared/result.js";
import type { CodeAnalyzer, Finding, ReviewContext, ReviewError } from "../CodeAnalyzer.js";

const LONG_FUNCTION_LINES = 50;
const MAX_PARAMS = 4;
const MAX_NESTING = 3;

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

function analyzeFile(filePath: string, content: string): Finding[] {
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  const findings: Finding[] = [];

  function visit(node: ts.Node): void {
    if (isFunctionLike(node)) {
      const name = getFunctionName(node, sourceFile);
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
      const lineCount = end.line - start.line + 1;
      const paramCount = node.parameters.length;
      const nestingDepth = countMaxNesting(node);
      const firstLine = content.slice(node.getStart(), node.getStart() + 120).split("\n")[0] ?? "";

      if (lineCount > LONG_FUNCTION_LINES) {
        findings.push({
          severity: "low",
          title: `Long function "${name}" (${lineCount} lines)`,
          description: `"${name}" spans ${lineCount} lines, exceeding the ${LONG_FUNCTION_LINES}-line guideline. Long functions are harder to read, test, and maintain. Consider splitting it into smaller, focused functions.`,
          evidence: firstLine,
          file: filePath,
          lines: { start: start.line + 1, end: end.line + 1 },
          pass: "smells",
          source: "static",
        });
      }

      if (paramCount > MAX_PARAMS) {
        findings.push({
          severity: "low",
          title: `Too many parameters in "${name}" (${paramCount})`,
          description: `"${name}" has ${paramCount} parameters. Functions with more than ${MAX_PARAMS} parameters are hard to call correctly. Consider grouping related parameters into an options object.`,
          evidence: firstLine,
          file: filePath,
          lines: { start: start.line + 1, end: start.line + 1 },
          pass: "smells",
          source: "static",
        });
      }

      if (nestingDepth > MAX_NESTING) {
        findings.push({
          severity: "low",
          title: `Deep nesting in "${name}" (depth ${nestingDepth})`,
          description: `"${name}" has a maximum nesting depth of ${nestingDepth}. Deeply nested code is hard to follow. Consider early returns, guard clauses, or extracting nested logic into helper functions.`,
          evidence: firstLine,
          file: filePath,
          lines: { start: start.line + 1, end: start.line + 1 },
          pass: "smells",
          source: "static",
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  ts.forEachChild(sourceFile, visit);
  return findings;
}

export class SmellsAnalyzer implements CodeAnalyzer {
  readonly id = "smells" as const;

  analyze(context: ReviewContext): Promise<Result<readonly Finding[], ReviewError>> {
    const findings: Finding[] = [];

    for (const file of context.diff.files) {
      if (file.status === "deleted") continue;
      if (!isAnalyzable(file.newPath)) continue;

      const content = context.files.get(file.newPath);
      if (!content) continue;

      findings.push(...analyzeFile(file.newPath, content));
    }

    return Promise.resolve(ok(findings));
  }
}
