import ts from "typescript";

const TS_JS_RE = /\.[jt]sx?$/;

/**
 * Extract the public API surface of a TypeScript/JavaScript file: exported
 * declarations with their signatures but without implementation bodies.
 *
 * Used for cross-file import context so the AI sees type information without
 * paying the token cost of full implementations.
 *
 * Falls back to full content for non-TS/JS files, parse failures, or files
 * that export nothing.
 */
export function extractExportedSymbols(content: string, filePath: string): string {
  if (!TS_JS_RE.test(filePath)) return content;

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
