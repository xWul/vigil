import type { Language } from "./language.js";

export interface LanguageHeuristics {
  functionBoundary: RegExp;
  complexityKeywords: RegExp;
  // null = language uses absolute imports (Java, C#, Go, Ruby, Kotlin, Rust)
  relativeImport: RegExp | null;
}

export interface HeuristicFunction {
  name: string;
  startLine: number; // 1-indexed
  endLine: number; // 1-indexed
  firstLine: string; // trimmed declaration line, used as evidence
}

const UNIVERSAL_COMPLEXITY =
  /\b(?:if|elif|else\s+if|for|while|case|catch|except)\b|&&|\|\||\?(?![.?\w])/;

const RUBY_COMPLEXITY = /\b(?:if|elsif|unless|while|until|for|when|rescue)\b|\?(?![.?\w])/;

const HEURISTICS: Partial<Record<Language, LanguageHeuristics>> = {
  python: {
    functionBoundary: /^[ \t]*(?:async\s+)?def\s+(\w+)\s*\(/,
    complexityKeywords: UNIVERSAL_COMPLEXITY,
    relativeImport: /from\s+(\.+)([\w.]*)\s+import/,
  },
  java: {
    functionBoundary:
      /^[ \t]*(?:(?:public|private|protected|static|final|abstract|synchronized|native)\s+)+(?:<[^>]+>\s+)?[\w<>[\]]+\s+(\w+)\s*\(/,
    complexityKeywords: UNIVERSAL_COMPLEXITY,
    relativeImport: null,
  },
  csharp: {
    functionBoundary:
      /^[ \t]*(?:(?:public|private|protected|internal|static|virtual|override|abstract|sealed|async|new)\s+)+(?:[\w<>[\]?]+\s+)+(\w+)\s*\(/,
    complexityKeywords: UNIVERSAL_COMPLEXITY,
    relativeImport: null,
  },
  go: {
    functionBoundary: /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(/,
    complexityKeywords: UNIVERSAL_COMPLEXITY,
    relativeImport: null,
  },
  ruby: {
    functionBoundary: /^[ \t]*def\s+(\w+)/,
    complexityKeywords: RUBY_COMPLEXITY,
    relativeImport: null,
  },
  kotlin: {
    functionBoundary:
      /^[ \t]*(?:(?:public|private|protected|internal|open|override|abstract|final|suspend|inline|operator)\s+)*fun\s+(?:<[^>]+>\s+)?(\w+)\s*\(/,
    complexityKeywords: UNIVERSAL_COMPLEXITY,
    relativeImport: null,
  },
  rust: {
    functionBoundary: /^[ \t]*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]+>)?\s*\(/,
    complexityKeywords: UNIVERSAL_COMPLEXITY,
    relativeImport: null,
  },
};

export function getHeuristics(lang: Language): LanguageHeuristics | null {
  return HEURISTICS[lang] ?? null;
}

// ---------------------------------------------------------------------------
// Function extraction — used by ComplexityAnalyzer and SmellsAnalyzer
// ---------------------------------------------------------------------------

function extractPythonFunctions(lines: string[]): HeuristicFunction[] {
  const re = /^([ \t]*)(?:async\s+)?def\s+(\w+)\s*\(/;
  const functions: HeuristicFunction[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = re.exec(line);
    if (!match) continue;

    const baseIndent = match[1]!.length;
    const name = match[2]!;
    const startLine = i + 1;
    let endLine = startLine;

    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j]!;
      if (next.trim() === "" || /^[ \t]*#/.test(next)) {
        endLine = j + 1;
        continue;
      }
      const nextIndent = next.length - next.trimStart().length;
      if (nextIndent <= baseIndent) break;
      endLine = j + 1;
    }

    functions.push({ name, startLine, endLine, firstLine: line.trimStart() });
  }

  return functions;
}

function extractRubyFunctions(lines: string[]): HeuristicFunction[] {
  const defRe = /^([ \t]*)def\s+(\w+)/;
  const functions: HeuristicFunction[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = defRe.exec(line);
    if (!match) continue;

    const name = match[2]!;
    const startLine = i + 1;
    let endLine = startLine;
    let depth = 1;

    for (let j = i + 1; j < lines.length; j++) {
      const trimmed = (lines[j] ?? "").trim();
      if (
        /^(?:def|class|module|begin)\b/.test(trimmed) ||
        /\bdo\b(?:\s*\|[^|]*\|)?\s*$/.test(trimmed)
      )
        depth++;
      if (/^end\b/.test(trimmed)) {
        depth--;
        if (depth === 0) {
          endLine = j + 1;
          break;
        }
      }
      endLine = j + 1;
    }

    functions.push({ name, startLine, endLine, firstLine: line.trimStart() });
  }

  return functions;
}

function extractBraceFunctions(lines: string[], boundaryRe: RegExp): HeuristicFunction[] {
  const functions: HeuristicFunction[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = boundaryRe.exec(line);
    if (!match) continue;

    const name = match[1] ?? "unknown";
    const startLine = i + 1;
    let depth = 0;
    let foundOpen = false;
    let endLine = startLine;
    let done = false;

    for (let j = i; j < lines.length && !done; j++) {
      for (const ch of lines[j]!) {
        if (ch === "{") {
          depth++;
          foundOpen = true;
        } else if (ch === "}" && foundOpen) {
          depth--;
          if (depth === 0) {
            endLine = j + 1;
            done = true;
            break;
          }
        }
      }
    }

    if (foundOpen) {
      functions.push({ name, startLine, endLine, firstLine: line.trimStart() });
    }
  }

  return functions;
}

export function extractFunctions(lang: Language, content: string): HeuristicFunction[] {
  if (!getHeuristics(lang)) return [];

  const lines = content.split("\n");
  if (lang === "python") return extractPythonFunctions(lines);
  if (lang === "ruby") return extractRubyFunctions(lines);

  const h = getHeuristics(lang)!;
  return extractBraceFunctions(lines, h.functionBoundary);
}

// ---------------------------------------------------------------------------
// Python import resolver — used by ArchitectureAnalyzer and buildReviewContext
// ---------------------------------------------------------------------------

export function resolvePythonImport(
  fromFile: string,
  dots: string,
  modulePath: string,
): string | null {
  if (!modulePath) return null;
  const dir = fromFile.includes("/") ? fromFile.split("/").slice(0, -1) : [];
  const levelsUp = dots.length - 1;
  const base = levelsUp > 0 ? dir.slice(0, dir.length - levelsUp) : dir;
  return [...base, ...modulePath.split(".")].join("/") + ".py";
}
