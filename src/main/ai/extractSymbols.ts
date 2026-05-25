import ts from "typescript";

import { detectLanguage } from "./language.js";

/**
 * Extract the public API surface of a source file: declarations with their
 * signatures but without implementation bodies.
 *
 * Used for cross-file import context so the AI sees type information without
 * paying the token cost of full implementations.
 *
 * TypeScript/JavaScript: uses the TypeScript compiler AST for precise extraction.
 * Python: regex-based extraction of public function/class signatures.
 * Java: regex-based extraction of public/protected declarations.
 * Other languages: returns full content unchanged.
 */
export function extractExportedSymbols(content: string, filePath: string): string {
  const lang = detectLanguage(filePath);
  if (lang === "python") return extractPythonSymbols(content, filePath);
  if (lang === "java") return extractJavaSymbols(content, filePath);
  if (lang !== "typescript") return content;

  let sourceFile: ts.SourceFile;
  try {
    sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  } catch {
    return content;
  }

  const parts: string[] = [`// [symbol summary: ${filePath}]`];

  for (const stmt of sourceFile.statements) {
    const snippet = exportedSignature(content, stmt);
    if (snippet !== null) parts.push(snippet);
  }

  if (parts.length === 1) return content;

  return parts.join("\n");
}

function exportedSignature(content: string, stmt: ts.Statement): string | null {
  if (ts.isExportDeclaration(stmt)) {
    return content.slice(stmt.getStart(), stmt.getEnd());
  }

  if (!hasExportKeyword(stmt)) return null;

  if (ts.isFunctionDeclaration(stmt)) {
    return stmt.body
      ? content.slice(stmt.getStart(), stmt.body.getStart()) + "{}"
      : content.slice(stmt.getStart(), stmt.getEnd());
  }

  if (ts.isClassDeclaration(stmt)) {
    return classSignature(content, stmt);
  }

  if (
    ts.isInterfaceDeclaration(stmt) ||
    ts.isTypeAliasDeclaration(stmt) ||
    ts.isEnumDeclaration(stmt)
  ) {
    return content.slice(stmt.getStart(), stmt.getEnd());
  }

  if (ts.isVariableStatement(stmt)) {
    return variableSignature(content, stmt);
  }

  return null;
}

function hasExportKeyword(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  return ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function classSignature(content: string, cls: ts.ClassDeclaration): string {
  // cls.members.pos points just past the opening `{` of the class body.
  // Slicing up to that position captures the class header including `{`.
  const header = content.slice(cls.getStart(), cls.members.pos);
  const memberLines: string[] = [];

  for (const member of cls.members) {
    if (isPrivateMember(member)) continue;

    if (
      ts.isMethodDeclaration(member) ||
      ts.isConstructorDeclaration(member) ||
      ts.isGetAccessorDeclaration(member) ||
      ts.isSetAccessorDeclaration(member)
    ) {
      const body = member.body;
      const sig = body
        ? content.slice(member.getStart(), body.getStart()).trimEnd() + " {}"
        : content.slice(member.getStart(), member.getEnd());
      memberLines.push("  " + sig);
    } else if (ts.isPropertyDeclaration(member)) {
      memberLines.push("  " + content.slice(member.getStart(), member.getEnd()));
    }
  }

  return header + memberLines.join("\n") + "\n}";
}

function isPrivateMember(member: ts.ClassElement): boolean {
  if (!ts.canHaveModifiers(member)) return false;
  return ts.getModifiers(member)?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword) ?? false;
}

function variableSignature(content: string, stmt: ts.VariableStatement): string {
  const declarations = stmt.declarationList.declarations;
  if (declarations.length !== 1) return content.slice(stmt.getStart(), stmt.getEnd());

  const decl = declarations[0]!;
  const init = decl.initializer;
  if (!init) return content.slice(stmt.getStart(), stmt.getEnd());

  if (ts.isArrowFunction(init) && ts.isBlock(init.body)) {
    return content.slice(stmt.getStart(), init.body.getStart()) + "{};";
  }

  if (ts.isFunctionExpression(init) && init.body) {
    return content.slice(stmt.getStart(), init.body.getStart()) + "{};";
  }

  return content.slice(stmt.getStart(), stmt.getEnd());
}

// ---------------------------------------------------------------------------
// Python symbol extraction
// ---------------------------------------------------------------------------

function extractPythonSymbols(content: string, filePath: string): string {
  const lines = content.split("\n");
  const result: string[] = [`# [symbol summary: ${filePath}]`];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("@")) {
      result.push(trimmed);
      continue;
    }

    if (/^class\s+/.test(trimmed)) {
      result.push(trimmed);
      continue;
    }

    const defMatch = /^[ \t]*(?:async\s+)?def\s+(\w+)\s*\(/.exec(line);
    if (defMatch) {
      const name = defMatch[1]!;
      // include public functions/methods and dunder methods; skip single-underscore private
      if (!name.startsWith("_") || (name.startsWith("__") && name.endsWith("__"))) {
        result.push(trimmed.endsWith(":") ? trimmed : `${trimmed}...`);
      }
    }
  }

  return result.length > 1 ? result.join("\n") : content;
}

// ---------------------------------------------------------------------------
// Java symbol extraction
// ---------------------------------------------------------------------------

function extractJavaSymbols(content: string, filePath: string): string {
  const lines = content.split("\n");
  const result: string[] = [`// [symbol summary: ${filePath}]`];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

    // Class / interface / enum / record declarations
    if (
      /^(?:public|protected)(?:\s+\w+)*\s+(?:class|interface|enum|record|@interface)\s+\w+/.test(
        trimmed,
      )
    ) {
      result.push(trimmed.replace(/\s*\{.*$/, " {"));
      continue;
    }

    // Method / constructor declarations — strip body, keep signature
    if (
      /^(?:public|protected)\s+/.test(trimmed) &&
      /\w+\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?\s*\{/.test(trimmed)
    ) {
      result.push(trimmed.replace(/\s*\{.*$/, ";"));
    }
  }

  return result.length > 1 ? result.join("\n") : content;
}
