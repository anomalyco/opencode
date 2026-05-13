export type ExactAliasRule = {
    aliasModelID: string;
    ruleID: string;
    canonicalModelID: string;
    rationale: string;
};
export type PatternAliasRule = {
    ruleID: string;
    description: string;
    match: (normalizedModelID: string) => boolean;
    canonicalize: (normalizedModelID: string) => string;
};
export type ModelIDAliasResolution = {
    requestedModelID: string;
    canonicalModelID: string;
    source: "canonical" | "exact-alias" | "pattern-alias";
    ruleID?: string;
};
export declare function resolveModelIDAlias(modelID: string): ModelIDAliasResolution;
export declare function getExactModelIDAliasRules(): ReadonlyArray<ExactAliasRule>;
export declare function getPatternModelIDAliasRules(): ReadonlyArray<PatternAliasRule>;
