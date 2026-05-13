export type VisionCapableModel = {
    providerID: string;
    modelID: string;
};
export interface ModelCacheState {
    modelContextLimitsCache: Map<string, number>;
    visionCapableModelsCache?: Map<string, VisionCapableModel>;
    anthropicContext1MEnabled: boolean;
}
export declare function createModelCacheState(): ModelCacheState;
