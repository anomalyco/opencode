import type { ModelRequirement } from "../../../shared/model-requirements";
import type { OmoConfig } from "./model-resolution-types";
export declare function formatModelWithVariant(model: string, variant?: string): string;
export declare function getEffectiveVariant(agentName: string, requirement: ModelRequirement, config: OmoConfig): string | undefined;
export declare function getCategoryEffectiveVariant(categoryName: string, requirement: ModelRequirement, config: OmoConfig): string | undefined;
