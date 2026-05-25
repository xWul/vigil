# Multi-language support

Static analysis and context enrichment for languages beyond TypeScript/JavaScript.

## Supported languages

| Language   | Extensions                                                   | Test file pattern              |
| ---------- | ------------------------------------------------------------ | ------------------------------ | ---------------------------------------- |
| TypeScript | `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs`, `.cjs` | `/(test\|spec)\.[jt]sx?$/`     |
| Python     | `.py`                                                        | `/(?:^                         | \/)test\_[^/]\*\.py$/` or `/_test\.py$/` |
| Java       | `.java`                                                      | `/(Test\|Tests\|Spec)\.java$/` |
| C#         | `.cs`                                                        | `/(Tests?\|Spec)\.cs$/`        |
| Go         | `.go`                                                        | `/_test\.go$/`                 |
| Ruby       | `.rb`                                                        | `/(_spec\|_test)\.rb$/`        |
| Kotlin     | `.kt`, `.kts`                                                | `/(Test\|Tests\|Spec)\.kt$/`   |
| Rust       | `.rs`                                                        | _(not yet implemented)_        |

Classification lives in `src/main/ai/language.ts`. Language is determined from file extension only — no content sniffing.

## Analysis parity per language

| Analyzer                 | TypeScript/JS               | Python                                      | Java, C#, Go, Ruby                             |
| ------------------------ | --------------------------- | ------------------------------------------- | ---------------------------------------------- |
| ComplexityAnalyzer       | AST (TS compiler)           | Heuristic (regex)                           | Heuristic (regex)                              |
| SmellsAnalyzer           | AST (TS compiler)           | Heuristic (regex)                           | Heuristic (regex)                              |
| ArchitectureAnalyzer     | AST (relative import graph) | Regex (relative imports)                    | Skipped (absolute imports, unresolvable)       |
| SilentRegressionAnalyzer | Full (all detectors)        | Full (detectors 1–3; 4–5 TS-only, harmless) | Full (detectors 1–3; 4–5 harmless)             |
| DebugArtifactsAnalyzer   | console.\*, debugger        | print()                                     | System.out.println / Console.Write / fmt.Print |
| TypeSafetyAnalyzer       | Full                        | Skipped (TS-specific)                       | Skipped (TS-specific)                          |

### Heuristic analysis

Languages without a JavaScript-side AST parser use regex-based heuristics defined in `src/main/ai/heuristics.ts`. Each language entry provides:

- `functionBoundary`: detects function/method declaration lines and estimates body extents
- `complexityKeywords`: control-flow keywords used for cyclomatic complexity counting
- `relativeImport`: relative import regex, or `null` for languages that use absolute imports

TypeScript/JavaScript always uses the TypeScript compiler API for precision. Heuristics are the fallback for all other languages.

## Symbol extraction

Symbol extraction strips implementation bodies to reduce token cost when cross-file context is included.

| Language   | Method          | What is extracted                                            |
| ---------- | --------------- | ------------------------------------------------------------ |
| TypeScript | TS compiler AST | Exported declarations with signatures, class public API      |
| Python     | Regex           | `class` declarations, public `def` signatures, decorators    |
| Java       | Regex           | `public`/`protected` class, interface, and method signatures |
| Other      | —               | Full file content (no extraction)                            |

## Cross-file context enrichment

Relative imports in changed files are resolved to repo-relative paths and fetched from the local cache within the cross-file token budget (20% of total).

| Language   | Cross-file enrichment | Import resolution                                                               |
| ---------- | --------------------- | ------------------------------------------------------------------------------- |
| TypeScript | Yes                   | `from './foo'` → resolves `.js` → `.ts` extension rewrite                       |
| Python     | Yes                   | `from .foo import bar` / `from ..pkg.mod import X` → relative path resolution   |
| Java       | No                    | `import com.example.Foo` — requires build-system source-root knowledge          |
| C#         | No                    | `using Namespace.Class` — same limitation as Java                               |
| Go         | No                    | `import "pkg/path"` — module-relative, not file-relative                        |
| Ruby       | No                    | `require_relative` is file-relative but resolved at runtime; not enriched in v0 |

## Lock files excluded from review

The following lock files are excluded from review alongside `package-lock.json` and `yarn.lock`:

- `pnpm-lock.yaml`
- `Pipfile.lock` (Python)
- `go.sum` (Go)
- `packages.lock.json` (NuGet / C#)

## Architecture notes

`language.ts` is responsible solely for classification (extension → `Language`, `isTestFile`). Structural knowledge (how to parse a function boundary, what constitutes a relative import) lives exclusively in `heuristics.ts`. Analyzers import from both but never implement language detection or structural parsing themselves.

The `Language` type includes `kotlin` and `rust` as forward-looking entries. No analyzer fully implements them yet. The architecture does not use exhaustive switches without default cases, so adding a new language requires only:

1. A new extension entry in `language.ts`
2. A new `LanguageHeuristics` entry in `heuristics.ts`
3. Any language-scoped debug artifact patterns in `DebugArtifactsAnalyzer.ts`
