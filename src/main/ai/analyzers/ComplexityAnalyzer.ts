import ts from "typescript";

import type { ResolvedAnalyzerConfig } from "../../../shared/analyzer-config.js";
import { DEFAULT_ANALYZER_CONFIG } from "../../../shared/analyzer-config.js";
import { ok } from "../../../shared/result.js";
import type { Result } from "../../../shared/result.js";
import type { CodeAnalyzer, Finding, ReviewContext, ReviewError } from "../CodeAnalyzer.js";
import { extractFunctions, getHeuristics } from "../heuristics.js";
import { detectLanguage } from "../language.js";

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
    if (isFunctionLike(n)) return;
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

function analyzeFile(
  filePath: string,
  content: string,
  changedRanges?: readonly LineRange[],
  threshold = DEFAULT_ANALYZER_CONFIG.analyzers.complexity.threshold,
): Finding[] {
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  const findings: Finding[] = [];

  function visit(node: ts.Node): void {
    if (isFunctionLike(node)) {
      const complexity = computeComplexity(node);
      if (complexity > threshold) {
        const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
        const funcStart = start.line + 1;
        const funcEnd = end.line + 1;
        if (!changedRanges || overlapsAnyRange(funcStart, funcEnd, changedRanges)) {
          const name = getFunctionName(node);
          findings.push({
            severity: complexity > 20 ? "high" : "medium",
            title: `High cyclomatic complexity in "${name}" (${complexity})`,
            description: `The function "${name}" has a cyclomatic complexity of ${complexity}, exceeding the threshold of ${threshold}. High complexity makes the function harder to test and understand. Consider extracting smaller, focused functions.`,
            evidence: content.slice(node.getStart(), node.getStart() + 120).split("\n")[0] ?? "",
            file: filePath,
            lines: { start: funcStart, end: funcStart },
            pass: "complexity",
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

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"]);

function isTsAnalyzable(path: string): boolean {
  const ext = path.slice(path.lastIndexOf("."));
  return TS_EXTENSIONS.has(ext);
}

function countHeuristicComplexity(
  lines: string[],
  startLine: number,
  endLine: number,
  keywords: RegExp,
): number {
  let complexity = 1;
  const re = new RegExp(keywords.source, "g");
  for (let i = startLine - 1; i < endLine && i < lines.length; i++) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lines[i]!)) !== null) {
      complexity++;
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  return complexity;
}

function analyzeFileHeuristic(
  filePath: string,
  content: string,
  changedRanges: readonly LineRange[] | undefined,
  threshold: number,
): Finding[] {
  const lang = detectLanguage(filePath);
  if (!lang) return [];
  const h = getHeuristics(lang);
  if (!h) return [];

  const funcs = extractFunctions(lang, content);
  if (funcs.length === 0) return [];

  const lines = content.split("\n");
  const findings: Finding[] = [];

  for (const func of funcs) {
    if (changedRanges && !overlapsAnyRange(func.startLine, func.endLine, changedRanges)) continue;
    const complexity = countHeuristicComplexity(
      lines,
      func.startLine,
      func.endLine,
      h.complexityKeywords,
    );
    if (complexity > threshold) {
      findings.push({
        severity: complexity > 20 ? "high" : "medium",
        title: `High cyclomatic complexity in "${func.name}" (${complexity})`,
        description: `The function "${func.name}" has a cyclomatic complexity of ${complexity}, exceeding the threshold of ${threshold}. High complexity makes the function harder to test and understand. Consider extracting smaller, focused functions.`,
        evidence: func.firstLine,
        file: filePath,
        lines: { start: func.startLine, end: func.startLine },
        pass: "complexity",
        source: "static",
      });
    }
  }

  return findings;
}

type ComplexityConfig = ResolvedAnalyzerConfig["analyzers"]["complexity"];

export class ComplexityAnalyzer implements CodeAnalyzer {
  readonly id = "complexity" as const;
  private readonly cfg: ComplexityConfig;

  constructor(config?: ComplexityConfig) {
    this.cfg = config ?? DEFAULT_ANALYZER_CONFIG.analyzers.complexity;
  }

  analyze(context: ReviewContext): Promise<Result<readonly Finding[], ReviewError>> {
    if (!this.cfg.enabled) return Promise.resolve(ok([]));

    const findings: Finding[] = [];

    for (const file of context.diff.files) {
      if (file.status === "deleted") continue;

      const content = context.files.get(file.newPath);
      if (!content) continue;

      const changedRanges =
        file.status === "added"
          ? undefined
          : file.hunks.map((h) => ({ start: h.newStart, end: h.newStart + h.newCount - 1 }));

      if (isTsAnalyzable(file.newPath)) {
        findings.push(...analyzeFile(file.newPath, content, changedRanges, this.cfg.threshold));
      } else {
        findings.push(
          ...analyzeFileHeuristic(file.newPath, content, changedRanges, this.cfg.threshold),
        );
      }
    }

    return Promise.resolve(ok(findings));
  }
}
