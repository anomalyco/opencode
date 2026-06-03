import type { GeneratedOmoConfig, ProviderAvailability } from "./model-fallback-types";
export declare function isOpenAiOnlyAvailability(availability: ProviderAvailability): boolean;
export declare function applyOpenAiOnlyModelCatalog(config: GeneratedOmoConfig): GeneratedOmoConfig;
