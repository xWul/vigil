# Spec: Configurable Analyzer Settings

## Goal

Let users tune every static analysis parameter — thresholds, enable/disable per pass,
per-detector toggles — through a workspace UI panel. Config is stored per-repo in
`userData` and can be exported as `.vigilrc` for team sharing.

## Decisions (see ADR-0012 for rationale)

- Config is **per-repo**, keyed by `{platform}/{owner}/{repo}` in `userData`.
- **One layer**: no global user defaults; hardcoded Vigil defaults are the fallback.
- **Level A configurability**: enable/disable + numeric thresholds only. No severity
  overrides, no custom regex patterns.
- **Constructor injection**: each analyzer receives its config slice at construction time.
  `ReviewContext` and the `CodeAnalyzer` interface are unchanged.
- **Workspace UI**: gear icon `⚙` in the workspace bottom strip opens a settings overlay.
  Save does not auto-trigger re-run — the existing "Re-run review" button handles that.
- **Auto-read of `.vigilrc` from the repo deferred**: v1 reads from `userData` only.
  "Export as .vigilrc" copies JSON to clipboard for manual commit.

---

## Config schema

Defined in `src/shared/analyzer-config.ts`. All keys optional; missing keys fall back
to defaults.

```typescript
export interface AnalyzerConfig {
  readonly analyzers: {
    readonly complexity?: {
      readonly enabled?: boolean; // default: true
      readonly threshold?: number; // default: 10
    };
    readonly smells?: {
      readonly enabled?: boolean; // default: true
      readonly maxFunctionLines?: number; // default: 50
      readonly maxParams?: number; // default: 4
      readonly maxNesting?: number; // default: 3
    };
    readonly duplication?: {
      readonly enabled?: boolean; // default: true
      readonly minBlockLines?: number; // default: 6
    };
    readonly regression?: {
      readonly enabled?: boolean; // default: true
      readonly detectors?: {
        readonly conditionChanges?: boolean; // default: true
        readonly errorHandling?: boolean; // default: true
        readonly numericChanges?: boolean; // default: true
        readonly asyncPatterns?: boolean; // default: true
        readonly sideEffects?: boolean; // default: true
      };
    };
    readonly debugArtifacts?: { readonly enabled?: boolean }; // default: true
    readonly typeSafety?: { readonly enabled?: boolean }; // default: true
    readonly changeClassification?: {
      readonly enabled?: boolean; // default: true
      readonly intentMismatch?: boolean; // default: true
    };
    readonly architecture?: { readonly enabled?: boolean }; // default: true
  };
  readonly maxFindingsPerAnalyzer?: number; // default: 10
}
```

A `resolveAnalyzerConfig(partial: AnalyzerConfig): ResolvedAnalyzerConfig` helper
returns a fully-populated config with all defaults applied. `ResolvedAnalyzerConfig`
has no optional fields — every key is required. Analyzers receive the resolved form.

`.vigilrc` is this same JSON shape (no wrapper, no version field needed in v1).

---

## Storage

**Key format**: `analyzerConfig.{platform}.{owner}.{repo}`  
Stored via the existing `electron-store` instance in the main process (same store as
`Settings`). Serialised as the partial `AnalyzerConfig` JSON — only overridden keys
are persisted; defaults are applied at read time.

**New IPC channels** (add to `src/shared/ipc-contract.ts`):

```typescript
"settings:getAnalyzerConfig": {
  args: [ref: PRRef];
  result: Result<AnalyzerConfig, SettingsError>;
}
"settings:setAnalyzerConfig": {
  args: [ref: PRRef, config: AnalyzerConfig];
  result: Result<void, SettingsError>;
}
```

The renderer passes the `PRRef` so the main process can derive the storage key without
the renderer constructing storage paths.

---

## Analyzer constructor changes

Each analyzer gains an optional config parameter. Missing or `undefined` → resolved
defaults. Signature example:

```typescript
// ComplexityAnalyzer
constructor(config?: ResolvedAnalyzerConfig["analyzers"]["complexity"]) {}

// SilentRegressionAnalyzer
constructor(config?: ResolvedAnalyzerConfig["analyzers"]["regression"]) {}
```

Disabled analyzers (`enabled: false`) still need to be instantiated — `analyze()` returns
`ok([])` immediately when disabled. This keeps the disabled state explicit rather than
conditionally removing analyzers from the array (which would make tests harder to write).

---

## IPC handler changes (`src/main/ipc/index.ts`)

In the `review:run` handler, before constructing analyzers:

1. Call `settingsStore.getAnalyzerConfig(ref)` → `partial`
2. Call `resolveAnalyzerConfig(partial)` → `config`
3. Pass slices to constructors:

```typescript
const config = resolveAnalyzerConfig(await settingsStore.getAnalyzerConfig(pr.ref));
const analyzers = [new ComplexityAnalyzer(config.analyzers.complexity), new DuplicationAnalyzer(config.analyzers.duplication), new SmellsAnalyzer(config.analyzers.smells), new DebugArtifactsAnalyzer(config.analyzers.debugArtifacts), new TypeSafetyAnalyzer(config.analyzers.typeSafety), new ChangeClassifierAnalyzer(config.analyzers.changeClassification), new SilentRegressionAnalyzer(config.analyzers.regression), new ArchitectureAnalyzer(config.analyzers.architecture)];
```

The `MAX_FINDINGS_PER_ANALYZER` constant in `runReview.ts` becomes
`config.maxFindingsPerAnalyzer`.

---

## Workspace UI

**Entry point**: a `⚙` icon button in the workspace bottom strip, left of "Re-run review".
Keyboard shortcut: `,` (comma — mnemonic: settings in many tools).

**Overlay**: same pattern as the existing `?` shortcuts overlay (centered, backdrop,
`Esc` to dismiss). Title: "Analyzer Settings". Two header buttons: "Export .vigilrc"
(copies JSON to clipboard, same pattern as copy diagnostics) and `✕` to close.

**Layout**: two grouped sections — "Static passes" and "Diff passes" — plus a
"Pipeline" footer row for `maxFindingsPerAnalyzer`.

Each analyzer row:

- Toggle (enabled/disabled) — disabling greys out all threshold controls for that analyzer
- Threshold inputs (number, min-clamped, no max except reasonable UI limits)
- Sub-toggles for per-detector analyzers (indented, only visible when parent enabled)

**Save behaviour**: a "Save" button at the bottom right. On save:

1. `settings:setAnalyzerConfig` IPC call with the current form state
2. Panel closes
3. A transient toast/banner: "Analyzer settings saved — re-run to apply"

"Restore defaults" button (bottom left): resets the form to hardcoded defaults without
saving (user must still click Save to persist).

---

## "Export as .vigilrc"

Generates the current resolved config as pretty-printed JSON and copies it to the
clipboard. Only includes keys that differ from defaults (i.e., the partial form) so
the exported file is minimal and readable.

Future: "Import from .vigilrc" button that reads a `.vigilrc` JSON string from the
clipboard and populates the form.

---

## Tests

- `resolveAnalyzerConfig`: unit tests for default merging (all keys absent → all defaults,
  partial override → correct merge, invalid partial → handled gracefully).
- Each analyzer: new test variants passing `enabled: false` → returns `ok([])`;
  passing custom thresholds → findings use the new threshold.
- IPC handler: integration test verifying config is read and passed to constructors
  before `runReview` is called.

---

## Out of scope for this phase

- Auto-read of `.vigilrc` from the repo at review time (ADR-0012).
- Severity overrides per analyzer (Level B configurability).
- Custom regex patterns for `DebugArtifactsAnalyzer` (Level C).
- Global user-level defaults separate from per-repo config (two-layer system).
- `Import from .vigilrc` (clipboard paste into the panel form).
