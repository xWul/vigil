# Regex heuristics for non-TypeScript static analysis

Static analysis of Java, Python, C#, Go, and Ruby uses regex-based heuristics rather than language-specific AST parsers.

## Context

Vigil's static analysis lane (complexity, smells, architecture, regression) was TypeScript/JavaScript-only. The TypeScript compiler API is used for TS/JS because it is already bundled as a dependency and provides accurate AST traversal. Extending to other languages requires a parsing strategy for each.

Three options were considered:

1. **Regex heuristics**: pattern-match on function boundaries and control-flow keywords; no new dependencies
2. **tree-sitter** (`node-tree-sitter` + grammars): accurate AST for any language; ~10–20 MB of new WASM/native dependencies per grammar; requires Electron NAPI compatibility work
3. **Subprocess to native tools** (pylint, javac, etc.): accurate but requires users to have language toolchains installed; rejected in ADR-0007

## Decision

Use regex heuristics (option 1) for all non-TypeScript languages.

Per-language structural patterns (`functionBoundary`, `complexityKeywords`, `relativeImport`) are defined in `src/main/ai/heuristics.ts`. Analyzers dispatch to the TypeScript compiler path for TS/JS files and to the heuristic path for everything else.

## Trade-offs

**Accepted limitations of regex heuristics:**

- Cannot accurately parse nested closures, multi-line parameter lists spanning arbitrary whitespace, or language features that require full syntax awareness
- Cyclomatic complexity counts may overcount (keyword matches in string literals or comments) or undercount (unusual control flow)
- Function boundary detection is approximate for languages with implicit end-of-function (Python relies on indentation, Ruby on `end` keyword counting)

**Mitigated by:**

- Findings from heuristic paths carry `source: "static"` (same as AST-derived findings) — the severity model doesn't differentiate, so users don't see a quality gap marker
- The AI lane (LLM pass) provides a second opinion on all code regardless of language, so false negatives from heuristics are partially covered
- The architecture keeps the two paths cleanly separated — migrating a language to tree-sitter later only requires replacing its `heuristics.ts` entry and updating the analyzer dispatch

## Considered alternatives

**tree-sitter**: rejected for v0 because it would add native/WASM dependencies requiring Electron compatibility work and significantly increasing the bundle. Revisit once the multi-language feature proves useful and grammar coverage priorities are clear.

**Subprocess tools**: rejected — see ADR-0007. Vigil targets users who do not necessarily have language toolchains installed locally.

## References

- ADR-0007: hybrid review pipeline (static + AI lanes)
- `src/main/ai/heuristics.ts`: LanguageHeuristics descriptors
- `docs/specs/multi-language-support.md`: supported languages, parity matrix
