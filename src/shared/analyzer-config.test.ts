import { describe, expect, it } from "vitest";
import { DEFAULT_ANALYZER_CONFIG, resolveAnalyzerConfig } from "./analyzer-config.js";

describe("resolveAnalyzerConfig", () => {
  it("returns defaults when called with no arguments", () => {
    expect(resolveAnalyzerConfig()).toEqual(DEFAULT_ANALYZER_CONFIG);
  });

  it("returns defaults when called with empty object", () => {
    expect(resolveAnalyzerConfig({})).toEqual(DEFAULT_ANALYZER_CONFIG);
  });

  it("overrides complexity threshold", () => {
    const resolved = resolveAnalyzerConfig({ analyzers: { complexity: { threshold: 20 } } });
    expect(resolved.analyzers.complexity.threshold).toBe(20);
    expect(resolved.analyzers.complexity.enabled).toBe(true);
  });

  it("disables an analyzer", () => {
    const resolved = resolveAnalyzerConfig({ analyzers: { duplication: { enabled: false } } });
    expect(resolved.analyzers.duplication.enabled).toBe(false);
    expect(resolved.analyzers.duplication.minBlockLines).toBe(6);
  });

  it("overrides smells thresholds", () => {
    const resolved = resolveAnalyzerConfig({
      analyzers: { smells: { maxFunctionLines: 100, maxParams: 8 } },
    });
    expect(resolved.analyzers.smells.maxFunctionLines).toBe(100);
    expect(resolved.analyzers.smells.maxParams).toBe(8);
    expect(resolved.analyzers.smells.maxNesting).toBe(3);
  });

  it("toggles individual regression detectors", () => {
    const resolved = resolveAnalyzerConfig({
      analyzers: { regression: { detectors: { conditionChanges: false, numericChanges: false } } },
    });
    expect(resolved.analyzers.regression.detectors.conditionChanges).toBe(false);
    expect(resolved.analyzers.regression.detectors.numericChanges).toBe(false);
    expect(resolved.analyzers.regression.detectors.errorHandling).toBe(true);
  });

  it("overrides maxFindingsPerAnalyzer", () => {
    const resolved = resolveAnalyzerConfig({ maxFindingsPerAnalyzer: 5 });
    expect(resolved.maxFindingsPerAnalyzer).toBe(5);
  });

  it("does not mutate DEFAULT_ANALYZER_CONFIG", () => {
    resolveAnalyzerConfig({ analyzers: { complexity: { threshold: 99 } } });
    expect(DEFAULT_ANALYZER_CONFIG.analyzers.complexity.threshold).toBe(10);
  });
});
