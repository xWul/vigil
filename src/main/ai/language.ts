export type Language =
  | "typescript"
  | "python"
  | "java"
  | "csharp"
  | "go"
  | "ruby"
  | "kotlin"
  | "rust";

const EXTENSION_MAP: Readonly<Record<string, Language>> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "typescript",
  ".jsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".mjs": "typescript",
  ".cjs": "typescript",
  ".py": "python",
  ".java": "java",
  ".cs": "csharp",
  ".go": "go",
  ".rb": "ruby",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".rs": "rust",
};

export function detectLanguage(filePath: string): Language | null {
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return null;
  return EXTENSION_MAP[filePath.slice(dot)] ?? null;
}

export function isTestFile(filePath: string): boolean {
  const lang = detectLanguage(filePath);
  switch (lang) {
    case "typescript":
      return /\.(test|spec)\.[jt]sx?$/.test(filePath);
    case "java":
      return /(Test|Tests|Spec)\.java$/.test(filePath);
    case "python":
      return /(?:^|\/)test_[^/]*\.py$/.test(filePath) || /[^/]*_test\.py$/.test(filePath);
    case "csharp":
      return /(Tests?|Spec)\.cs$/.test(filePath);
    case "go":
      return filePath.endsWith("_test.go");
    case "ruby":
      return /(_spec|_test)\.rb$/.test(filePath);
    case "kotlin":
      return /(Test|Tests|Spec)\.kt$/.test(filePath);
    default:
      return false;
  }
}
