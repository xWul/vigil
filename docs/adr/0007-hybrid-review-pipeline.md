# ADR-0007: Hybrid Review Pipeline — Static Analysis Alongside AI

## Status

Accepted — 2026-05-12

## Context

The core value proposition of Vigil is AI-assisted code review. The
obvious design is an AI-only pipeline: send the diff to an LLM, get
findings back.

Two things push against that:

1. **Not all users will connect an AI provider.** BYOK means the tool
   is only as useful as the user's willingness to provide an API key.
   A user who hasn't connected Anthropic or OpenAI gets nothing.

2. **AI is not the right tool for structural measurements.** Cyclomatic
   complexity, code duplication, and function length are deterministic
   properties of the code. An LLM can detect them, but inconsistently
   — it might flag a complex function in one PR and miss the same
   pattern in another. A deterministic analyzer flags them reliably,
   every time.

## Decision

The review pipeline has two lanes:

- **Static analysis lane** (`CodeAnalyzer[]`): runs unconditionally,
  in parallel, using the TypeScript compiler API. Produces `Finding[]`
  for complexity, duplication, and structural smells. Phase 3
  implements three analyzers: `ComplexityAnalyzer`, `DuplicationAnalyzer`,
  `SmellsAnalyzer`.

- **AI lane** (`AIProvider`): optional. Runs four sequential passes
  (correctness, security, consistency, summary) when an API key is
  present. The summary pass receives the combined findings from both
  lanes as input.

Both lanes produce the same `Finding` type. The `source` field
distinguishes origin (`"static"` vs `"ai"`). `ReviewResult` aggregates
findings from both lanes unconditionally.

## Considered Options

### AI-only pipeline

Simpler implementation. One abstraction (`AIProvider`) instead of two
(`AIProvider` + `CodeAnalyzer`). The LLM can catch complexity and
duplication alongside bugs and security issues.

Not chosen. An AI-only pipeline provides zero value without an API
key. Deterministic structural measurements should not depend on LLM
availability or consistency.

### Wrap existing tools (eslint, jscpd, plato)

Leverage mature ecosystems. Rich rule sets. No need to implement
AST traversal from scratch.

Not chosen. These tools require spawning subprocesses and parsing
non-uniform output formats into `Finding[]`. They also pull in large
dependency trees and introduce configuration that diverges from
Vigil's own TypeScript setup. The Phase 3 scope is deliberately narrow
(three analyzers, TypeScript/JavaScript only); hand-rolled
implementations give us full output control at lower complexity.

## Consequences

- The UI (Phase 5) can display findings even for users without an AI
  provider — static findings appear in the diff view alongside AI
  findings.
- `ReviewResult` is always populated, even with an empty AI lane.
  `summary` is an empty string and `riskScore` is `null` when AI is
  not configured.
- Adding new `CodeAnalyzer` implementations in future phases (e.g. a
  security-specific static analyzer) is additive — no interface changes
  needed.
- Phase 6 (local repo cache) can make static analyzers significantly
  more powerful by giving them full repo context, not just changed files.

## References

- `docs/specs/ai-review-pipeline.md` — full pipeline specification
- ROADMAP.md Phase 3
