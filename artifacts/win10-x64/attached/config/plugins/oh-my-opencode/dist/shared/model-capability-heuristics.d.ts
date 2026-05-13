export type HeuristicModelFamilyDefinition = {
    family: string;
    includes?: string[];
    pattern?: RegExp;
    variants?: string[];
    reasoningEfforts?: string[];
    supportsThinking?: boolean;
};
export declare const HEURISTIC_MODEL_FAMILY_REGISTRY: ReadonlyArray<HeuristicModelFamilyDefinition>;
export declare function detectHeuristicModelFamily(modelID: string): HeuristicModelFamilyDefinition | undefined;
