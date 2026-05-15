// Partial config — what gets persisted (only overridden keys).
export interface AnalyzerConfig {
  readonly analyzers?: {
    readonly complexity?: {
      readonly enabled?: boolean;
      readonly threshold?: number;
    };
    readonly smells?: {
      readonly enabled?: boolean;
      readonly maxFunctionLines?: number;
      readonly maxParams?: number;
      readonly maxNesting?: number;
    };
    readonly duplication?: {
      readonly enabled?: boolean;
      readonly minBlockLines?: number;
    };
    readonly regression?: {
      readonly enabled?: boolean;
      readonly detectors?: {
        readonly conditionChanges?: boolean;
        readonly errorHandling?: boolean;
        readonly numericChanges?: boolean;
        readonly asyncPatterns?: boolean;
        readonly sideEffects?: boolean;
      };
    };
    readonly debugArtifacts?: { readonly enabled?: boolean };
    readonly typeSafety?: { readonly enabled?: boolean };
    readonly changeClassification?: {
      readonly enabled?: boolean;
      readonly intentMismatch?: boolean;
    };
    readonly architecture?: { readonly enabled?: boolean };
  };
  readonly maxFindingsPerAnalyzer?: number;
}

// Fully resolved — every field required. Analyzers receive this form.
export interface ResolvedAnalyzerConfig {
  readonly analyzers: {
    readonly complexity: { readonly enabled: boolean; readonly threshold: number };
    readonly smells: {
      readonly enabled: boolean;
      readonly maxFunctionLines: number;
      readonly maxParams: number;
      readonly maxNesting: number;
    };
    readonly duplication: { readonly enabled: boolean; readonly minBlockLines: number };
    readonly regression: {
      readonly enabled: boolean;
      readonly detectors: {
        readonly conditionChanges: boolean;
        readonly errorHandling: boolean;
        readonly numericChanges: boolean;
        readonly asyncPatterns: boolean;
        readonly sideEffects: boolean;
      };
    };
    readonly debugArtifacts: { readonly enabled: boolean };
    readonly typeSafety: { readonly enabled: boolean };
    readonly changeClassification: { readonly enabled: boolean; readonly intentMismatch: boolean };
    readonly architecture: { readonly enabled: boolean };
  };
  readonly maxFindingsPerAnalyzer: number;
}

export const DEFAULT_ANALYZER_CONFIG: ResolvedAnalyzerConfig = {
  analyzers: {
    complexity: { enabled: true, threshold: 10 },
    smells: { enabled: true, maxFunctionLines: 50, maxParams: 4, maxNesting: 3 },
    duplication: { enabled: true, minBlockLines: 6 },
    regression: {
      enabled: true,
      detectors: {
        conditionChanges: true,
        errorHandling: true,
        numericChanges: true,
        asyncPatterns: true,
        sideEffects: true,
      },
    },
    debugArtifacts: { enabled: true },
    typeSafety: { enabled: true },
    changeClassification: { enabled: true, intentMismatch: true },
    architecture: { enabled: true },
  },
  maxFindingsPerAnalyzer: 10,
};

export function resolveAnalyzerConfig(partial: AnalyzerConfig = {}): ResolvedAnalyzerConfig {
  const d = DEFAULT_ANALYZER_CONFIG;
  const a = partial.analyzers ?? {};
  return {
    analyzers: {
      complexity: {
        enabled: a.complexity?.enabled ?? d.analyzers.complexity.enabled,
        threshold: a.complexity?.threshold ?? d.analyzers.complexity.threshold,
      },
      smells: {
        enabled: a.smells?.enabled ?? d.analyzers.smells.enabled,
        maxFunctionLines: a.smells?.maxFunctionLines ?? d.analyzers.smells.maxFunctionLines,
        maxParams: a.smells?.maxParams ?? d.analyzers.smells.maxParams,
        maxNesting: a.smells?.maxNesting ?? d.analyzers.smells.maxNesting,
      },
      duplication: {
        enabled: a.duplication?.enabled ?? d.analyzers.duplication.enabled,
        minBlockLines: a.duplication?.minBlockLines ?? d.analyzers.duplication.minBlockLines,
      },
      regression: {
        enabled: a.regression?.enabled ?? d.analyzers.regression.enabled,
        detectors: {
          conditionChanges:
            a.regression?.detectors?.conditionChanges ??
            d.analyzers.regression.detectors.conditionChanges,
          errorHandling:
            a.regression?.detectors?.errorHandling ??
            d.analyzers.regression.detectors.errorHandling,
          numericChanges:
            a.regression?.detectors?.numericChanges ??
            d.analyzers.regression.detectors.numericChanges,
          asyncPatterns:
            a.regression?.detectors?.asyncPatterns ??
            d.analyzers.regression.detectors.asyncPatterns,
          sideEffects:
            a.regression?.detectors?.sideEffects ?? d.analyzers.regression.detectors.sideEffects,
        },
      },
      debugArtifacts: {
        enabled: a.debugArtifacts?.enabled ?? d.analyzers.debugArtifacts.enabled,
      },
      typeSafety: {
        enabled: a.typeSafety?.enabled ?? d.analyzers.typeSafety.enabled,
      },
      changeClassification: {
        enabled: a.changeClassification?.enabled ?? d.analyzers.changeClassification.enabled,
        intentMismatch:
          a.changeClassification?.intentMismatch ?? d.analyzers.changeClassification.intentMismatch,
      },
      architecture: {
        enabled: a.architecture?.enabled ?? d.analyzers.architecture.enabled,
      },
    },
    maxFindingsPerAnalyzer: partial.maxFindingsPerAnalyzer ?? d.maxFindingsPerAnalyzer,
  };
}
