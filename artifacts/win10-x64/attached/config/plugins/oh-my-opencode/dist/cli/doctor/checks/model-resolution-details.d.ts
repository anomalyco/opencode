import type { AvailableModelsInfo, ModelResolutionInfo, OmoConfig } from "./model-resolution-types";
export declare function buildModelResolutionDetails(options: {
    info: ModelResolutionInfo;
    available: AvailableModelsInfo;
    config: OmoConfig;
}): string[];
