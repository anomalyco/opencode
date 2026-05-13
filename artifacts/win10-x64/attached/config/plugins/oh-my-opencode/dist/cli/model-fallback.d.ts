import type { InstallConfig } from "./types";
import type { GeneratedOmoConfig } from "./model-fallback-types";
export type { GeneratedOmoConfig } from "./model-fallback-types";
export declare function generateModelConfig(config: InstallConfig): GeneratedOmoConfig;
export declare function shouldShowChatGPTOnlyWarning(config: InstallConfig): boolean;
