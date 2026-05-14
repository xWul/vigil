# Spec: Architecture Analyzer

## Goal

Detect circular import dependencies among files touched by a PR and surface
them in the Architecture tab with enough context for a reviewer to understand
the cycle and act on it.

---

## Background

The Architecture tab was removed in Phase 7 because it showed hardcoded demo
data. This spec defines what real architecture analysis looks like for v1:
a single static detector that finds import cycles without requiring any
project-specific configuration.

---

## Scope

- Circular dependency detection among TypeScript/JavaScript files
- Relative imports only (`./` and `../` specifiers)
- Files examined: changed files (`diff.files`) + their direct imports
  (`context.files`, populated by `buildReviewContext`)
- Only cycles that involve at least one changed file are reported

**Out of scope (deferred):**
- Path alias resolution (`@/`, `~/`, tsconfig `paths`)
- Dynamic imports (`import('./foo')`)
- Layer violation detection
- Full-repo import graph analysis

---

## Pass identity

| Field | Value |
|---|---|
| `CodeAnalyzer.id` | `"architecture"` |
| `FindingPass` | `"architecture"` |
| `Finding.source` | `"static"` |

Named `"architecture"` rather than `"circular-deps"` to leave room for
additional architecture checks (e.g. layer violations) under the same pass
in future phases without changing the union types.

---

## Algorithm

### 1. Build the import graph

From `context.files` (a `ReadonlyMap<string, string>`), extract all relative
import specifiers using the existing `RELATIVE_IMPORT_RE` regex and
`resolveRelativeImport` helper from `buildReviewContext.ts`. Build a directed
adjacency map:

```
importGraph: Map<filePath, Set<importedFilePath>>
```

Only include edges where both the source and target file appear in
`context.files`. Edges to files outside the context are dropped silently —
this is expected when the repo cache is unavailable or the cross-file budget
is exhausted.

### 2. Detect cycles (DFS)

Standard iterative DFS with a `visited` set and a `recursionStack` set.
For each unvisited node, walk the graph depth-first. A back edge (edge to a
node already in `recursionStack`) indicates a cycle.

When a cycle is found, record the cycle path as an ordered list of file paths:
`[A, B, C, A]` (first element repeated at the end to make the chain readable).

Deduplicate cycles by normalizing the path to its lexicographically smallest
rotation.

### 3. Filter to diff-anchored cycles

Discard any cycle where no file in the cycle appears in `diff.files`. Only
cycles touching a changed file are reported.

### 4. Emit findings

For each cycle, emit one `Finding` per file in the cycle that also appears in
`diff.files`:

```typescript
{
  severity: "medium",
  title: `Circular import: ${shortName(fileA)} ↔ ${shortName(fileB)}`,
  // For cycles longer than 2: `Circular import: A → B → C → A`
  description: `${changedFile} participates in a circular dependency. Circular imports can cause initialization-order bugs and make dependency relationships hard to reason about.`,
  evidence: cycle.join("\n"),  // e.g. "src/a.ts\nsrc/b.ts\nsrc/a.ts"
  file: changedFile,
  lines: findImportLine(changedFile, nextFileInCycle, context.files),
  pass: "architecture",
  source: "static",
}
```

`shortName` returns the last two path segments (e.g. `auth/Provider.ts`).

`findImportLine` scans the file content line by line for the import statement
whose resolved path matches the next file in the cycle. Returns
`{ start: lineNumber, end: lineNumber }` if found, `null` if not.

---

## Implementation

### Files to create / modify

| File | Change |
|---|---|
| `src/shared/review.ts` | Add `"architecture"` to `FindingPass` union |
| `src/main/ai/CodeAnalyzer.ts` | Add `"architecture"` to `CodeAnalyzer.id` union |
| `src/main/ai/analyzers/ArchitectureAnalyzer.ts` | New — the analyzer |
| `src/main/ai/analyzers/ArchitectureAnalyzer.test.ts` | New — unit tests |
| `src/main/ai/runReview.ts` | Register the new analyzer |
| `src/renderer/features/workspace/AnalysisTabs.tsx` | Wire `ArchTab` with real data |
| `src/renderer/features/workspace/WorkspaceScreen.tsx` | Add `"architecture"` to `TabId`, render `ArchTab` |

### `runReview.ts` registration

`ArchitectureAnalyzer` is a static pass. It runs alongside the other static
analyzers in the parallel batch before AI passes begin.

---

## Architecture tab UI

### Data shape

The tab receives `findings: readonly Finding[]` filtered to
`pass === "architecture"`. Each finding's `evidence` field contains the cycle
chain as `\n`-separated file paths.

```typescript
function parseChain(evidence: string): string[] {
  return evidence.split("\n").filter(Boolean);
}
```

### Layout

**Header strip**: `"{n} circular {n === 1 ? 'dependency' : 'dependencies'} detected"` +
a right-aligned coverage note: `"Analysis covers changed files and their direct imports."`

**One card per finding**: displays the cycle chain as a horizontal node list
`A → B → C → A` with file names (last two path segments), plus the finding's
description below. Severity dot in the top-left corner.

**Empty state**: `"No circular dependencies detected among changed files."`

**Coverage note** (always visible in the footer): `"Only relative imports are
analyzed. Path alias imports (e.g. @/) are not resolved."`

### Tab registration

`"architecture"` added back to `TabId` and `TABS`. `tabCount` in `TabBar`
shows the count when `findings.filter(f => f.pass === "architecture").length > 0`,
with severity `"med"` (all cycle findings are `"medium"`).

---

## Graceful degradation

- If `context.files` contains only changed files (no cross-file imports — e.g.
  repo cache unavailable), the analyzer still runs and detects direct cycles
  between changed files. Coverage is reduced but not zero.
- `ArchitectureAnalyzer` failures are silent per the `CodeAnalyzer` contract —
  a failed analyzer logs a warning and returns empty findings; it never blocks
  the review.

---

## Testing

Unit tests in `ArchitectureAnalyzer.test.ts`:

- Direct cycle between two changed files is detected
- Transitive cycle (A→B→C→A) across changed + context files is detected
- Cycle involving only unchanged files is not reported
- No false positive when imports are one-directional
- `findImportLine` returns correct line number for a known import
- `findImportLine` returns `null` when the file is not in context
- Empty findings when no TypeScript/JavaScript files are changed
- Cycle deduplication: same cycle reported only once per changed file

---

## Known limitations

1. **Relative imports only.** Path aliases (`@/components/...`) are not
   resolved. Cycles through aliased paths are invisible to this analyzer.
2. **Budget-capped coverage.** If a file in the cycle was not fetched into
   `context.files` (due to token budget exhaustion), the cycle will not be
   detected.
3. **No pre-PR baseline.** The analyzer flags all cycles involving changed
   files, not just cycles *introduced* by the PR. A pre-existing cycle in a
   file the PR merely touches will appear as a finding. The description
   acknowledges this: "participates in a circular dependency."
