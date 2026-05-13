import type { FallbackEntry } from "../../shared/model-requirements";
import type { VisionCapableModel } from "../../plugin-state";
export declare function isHardcodedMultimodalFallbackModel(model: VisionCapableModel): boolean;
export declare function buildMultimodalLookerFallbackChain(visionCapableModels: VisionCapableModel[]): FallbackEntry[];
