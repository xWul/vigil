import ts from "typescript";

import { ok } from "../../../shared/result.js";
import type { Result } from "../../../shared/result.js";
import type { CodeAnalyzer, Finding, ReviewContext, ReviewError } from "../CodeAnalyzer.js";

const COMPLEXITY_THRESHOLD = 10;

const BRANCH_KINDS = new Set([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.CatchClause,
  ts.SyntaxKind.ConditionalExpression,
  ts.SyntaxKind.CaseClause,
]);

function computeComplexity(node: ts.Node): number {
  let complexity = 1;

  function visit(n: ts.Node): void {
    if (BRANCH_KINDS.has(n.kind)) {
      complexity++;
    } else if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.kind;
      if (
        op === ts.SyntaxKind.AmpersandAmpersandToken ||
        op === ts.SyntaxKind.BarBarToken ||
        op === ts.SyntaxKind.QuestionQuestionToken
      ) {
        complexity++;
      }
    }
    ts.forEachChild(n, visit);
  }

  ts.forEachChild(node, visit);
  return complexity;
}

function getFunctionName(node: ts.FunctionLikeDeclaration): string {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
    const parent = node.parent;
    const className = ts.isClassDeclaration(parent) && parent.name ? parent.name.text + "." : "";
    return className + node.name.text;
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const parent = node.parent;
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
      return parent.name.text;
    }
    if (ts.isPropertyDeclaration(parent) && ts.isIdentifier(parent.name)) {
      return parent.name.text;
    }
  }
  return "anonymous";
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
      const complexity = computeComplexity(node);
      if (complexity > COMPLEXITY_THRESHOLD) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        const name = getFunctionName(node);
        findings.push({
          severity: complexity > 20 ? "high" : "medium",
          title: `High cyclomatic complexity in "${name}" (${complexity})`,
          description: `The function "${name}" has a cyclomatic complexity of ${complexity}, exceeding the threshold of ${COMPLEXITY_THRESHOLD}. High complexity makes the function harder to test and understand. Consider extracting smaller, focused functions.`,
          evidence: content.slice(node.getStart(), node.getStart() + 120).split("\n")[0] ?? "",
          file: filePath,
          lines: { start: line + 1, end: line + 1 },
          pass: "complexity",
          source: "static",
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  ts.forEachChild(sourceFile, visit);
  return findings;
}

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"]);

function isAnalyzable(path: string): boolean {
  const ext = path.slice(path.lastIndexOf("."));
  return TS_EXTENSIONS.has(ext);
}

export class ComplexityAnalyzer implements CodeAnalyzer {
  readonly id = "complexity" as const;

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
