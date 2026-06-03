import type { CheckResult, DoctorIssue } from "../types";
import type { ModelResolutionInfo, OmoConfig } from "./model-resolution-types";
export declare function getModelResolutionInfo(): ModelResolutionInfo;
export declare function getModelResolutionInfoWithOverrides(config: OmoConfig): ModelResolutionInfo;
export declare function collectCapabilityResolutionIssues(info: ModelResolutionInfo): DoctorIssue[];
export declare function checkModels(): Promise<CheckResult>;
export declare const checkModelResolution: typeof checkModels;
