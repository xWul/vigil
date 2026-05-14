# Spec: Silent Regression Detector

## Goal

Add a `SilentRegressionAnalyzer` that flags behavioral changes in a PR
that match known high-risk patterns — changes that are non-obvious from
a quick visual scan but historically cause production incidents.

The detector runs without AI. It uses a new "paired hunk analysis"
pattern: within each `Hunk`, consecutive removed lines followed by
consecutive added lines form a "change block" that represents the
before/after state of a single logical change. Detectors compare these
blocks rather than scanning lines in isolation.

All five detectors require at least two corroborating signals before
emitting a finding, minimizing false positives.

---

## SilentRegression (domain term)

A behavioral change in a PR that matches a known high-risk pattern and
is non-obvious from a quick visual scan of the diff. The risk is
intrinsic to the pattern — not dependent on whether tests exist.
Distinct from a code smell (structural, not behavioral) and from a
security finding (a separate risk category).

---

## New FindingPass value

`"regression"` — produced by `SilentRegressionAnalyzer`. Added to
`FindingPass` union and `CodeAnalyzer.id` union.

---

## Paired hunk analysis (shared helper)

Within a `Hunk`, lines appear interleaved in order (context/removed/added
in their natural position). A change to a single expression appears as
consecutive removed lines immediately followed by consecutive added lines.

The helper `extractChangePairs(hunk)` walks `hunk.lines` in order and
groups them into:

```ts
interface ChangePair {
  removed: readonly DiffLine[]; // consecutive removed lines
  added: readonly DiffLine[]; // consecutive added lines that follow
}
```

Pure additions (`removed: []`) and pure deletions (`added: []`) are
included. Context lines reset the current group.

---

## Finding shape

All findings use:

- `pass: "regression"`
- `source: "static"`
- `evidence`: a diff-style string showing the relevant removed and added
  lines, prefixed with `- ` and `+ `. For single-signal detectors
  (side effects), evidence is the added line only.
- `file`: `FileDiff.newPath`
- `lines`: line range from the added lines (`DiffLine.newLine`); null if
  newLine is unavailable.

---

## Detector 1: Condition operator changes

### Signals required (both must be present)

**Signal A — conditional context:** The changed line (removed or added)
contains at least one of: `if (`, `} else if (`, `while (`, `for (`,
or a ternary pattern (`?` and `:`).

**Signal B — structural similarity:** With all comparison and logical
operators removed, the removed and added lines are at least 70% similar
by token count. This confirms the change was an operator swap, not a
rewrite.

### Risky operator pairs

| Old operator | New operator | Risk                                                 |
| ------------ | ------------ | ---------------------------------------------------- |
| `>=`         | `===`        | Off-by-one: values above the limit no longer trigger |
| `>=`         | `>`          | Boundary: limit value now excluded                   |
| `<=`         | `===`        | Off-by-one: values below the limit no longer trigger |
| `<=`         | `<`          | Boundary: limit value now excluded                   |
| `>`          | `>=`         | Boundary: limit value now included                   |
| `<`          | `<=`         | Boundary: limit value now included                   |
| `!==`        | `===`        | Negation flipped: condition inverted                 |
| `!=`         | `==`         | Negation flipped: condition inverted                 |
| `&&`         | `\|\|`       | Logic inverted: AND → OR                             |
| `\|\|`       | `&&`         | Logic inverted: OR → AND                             |

Only 1→1 change pairs (one removed line, one added line).

### Output

- **Severity:** `high`
- **Title:** `"Condition operator changed: {old} → {new}"`
- **Description:** Explains the semantic difference between the old and
  new operator (e.g., "The old condition included the boundary value;
  the new condition does not.").
- **Evidence:** `- removed line\n+ added line`

---

## Detector 2: Error handling removal or change

### Pattern A — catch block removed

**Signals:**

1. A removed line in the hunk contains `catch (` or `catch(`.
2. No added line in the **same hunk** contains `catch (` or `catch(`.

**Output:**

- **Severity:** `high`
- **Title:** `"Catch block removed"`
- **Description:** "A catch block was removed. Errors that were previously
  handled will now propagate to callers. Check all call sites."
- **Evidence:** The removed `catch (` line.

### Pattern B — error now thrown instead of returning fallback

**Signals:**

1. A removed line in a catch context (within 5 lines of a removed or
   existing `catch (` in the same hunk) matches:
   `return\s+(null|undefined|false|\[\]|\{\})`.
2. An added line in the same hunk contains `throw `.

**Output:**

- **Severity:** `high`
- **Title:** `"Error handling changed: now throws instead of returning fallback"`
- **Description:** "A catch block that previously returned a safe fallback
  value now throws. Callers that do not handle this error will crash."
- **Evidence:** `- removed return line\n+ added throw line`

### Phase 2 (not in scope)

- Empty catch introduced: `catch (e) {}` — errors silently swallowed.
- `try {` removed without catch removal.

---

## Detector 3: Numeric constant changes in sensitive contexts

### Signals required (both must be present)

**Signal A — number literal changed:** The removed and added lines of a
1→1 change pair each contain at least one number literal, and the values
differ.

**Signal B — sensitivity keyword present:** The combined text of the
removed and added lines contains (case-insensitive substring match) at
least one of: `timeout`, `retry`, `retries`, `delay`, `interval`,
`limit`, `threshold`, `attempts`, `backoff`, `ttl`, `expir`, `duration`,
`wait`.

### Output

- **Severity:** `medium`
- **Title:** `"{Keyword} value changed: {old} → {new}"`
  (e.g., "Timeout value changed: 3000 → 10000")
- **Description:** Describes the direction of change and suggests
  verifying the intent (e.g., "Timeout increased 3.3×. Verify this is
  intentional — longer timeouts may increase resource contention.").
- **Evidence:** `- removed line\n+ added line`

---

## Detector 4: Async execution pattern changes

### Signals required (both must be present, within the same hunk)

**Signal A:** At least 2 removed lines each contain `\bawait\b`.

**Signal B:** At least 1 added line contains one of:
`Promise\.all\(`, `Promise\.allSettled\(`, `Promise\.race\(`,
`Promise\.any\(`.

### Output

- **Severity:** `medium`
- **Title:** `"Sequential await replaced by {combinator}"`
  (e.g., "Sequential await replaced by Promise.all")
- **Description:** "Execution order changed from sequential to parallel.
  Verify there are no ordering dependencies between the operations, and
  that error handling covers partial failures." For `allSettled`/`race`/
  `any`, note the specific failure semantics of that combinator.
- **Evidence:** The removed await lines and the added Promise combinator line.

---

## Detector 5: Side effect introductions

### Signals required

One signal is sufficient — these patterns are specific enough that a
second signal would only add noise.

**Browser storage patterns (added lines):**

- `localStorage\.` or `localStorage\[`
- `sessionStorage\.` or `sessionStorage\[`
- `document\.cookie`
- `indexedDB\.`

**Node.js file system write patterns (added lines):**

- `fs\.writeFile`, `fs\.appendFile`, `fs\.writeFileSync`
- `fs\.rmSync`, `fs\.unlinkSync`

### Output

- **Severity:** `medium`
- **Title:** `"New side effect: {type}"` (e.g., "New side effect: localStorage write")
- **Description:** Explains the persistence or mutation risk introduced.
- **Evidence:** The added line containing the pattern.

---

## Relationship to existing analyzers

`SilentRegressionAnalyzer` is the first analyzer to use **paired hunk
analysis** — comparing adjacent removed→added blocks as a unit. The
other diff-aware analyzers (`DebugArtifactsAnalyzer`, `TypeSafetyAnalyzer`)
scan lines in isolation; `ChangeClassifierAnalyzer` scans removed and
added lines independently.

The five detectors run over all TypeScript and JavaScript files in the
diff. Other file types are ignored (patterns are language-specific).

All five detectors run unconditionally — the analyzer returns the union
of all findings from all detectors.

---

## Exit criteria

- `pnpm test` passes with unit tests covering: happy path (zero findings
  on clean diff), each detector's triggering case, and each detector's
  non-triggering edge cases (wrong hunk, missing second signal, etc.).
- Running `pnpm review <pr-url>` on a PR that changes `attempt >= retries`
  to `attempt === retries` produces a `"regression"` finding at `high`
  severity pointing to the correct line.
- Running `pnpm review <pr-url>` on a PR that removes a `catch` block
  produces a `"regression"` finding at `high` severity.
