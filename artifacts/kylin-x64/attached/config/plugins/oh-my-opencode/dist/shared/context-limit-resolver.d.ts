export type ContextLimitModelCacheState = {
    anthropicContext1MEnabled: boolean;
    modelContextLimitsCache?: Map<string, number>;
};
export declare function resolveActualContextLimit(providerID: string, modelID: string, modelCacheState?: ContextLimitModelCacheState): number | null;
