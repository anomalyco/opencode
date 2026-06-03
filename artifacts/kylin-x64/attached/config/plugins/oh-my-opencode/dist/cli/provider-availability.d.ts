import type { InstallConfig } from "./types";
import type { ProviderAvailability } from "./model-fallback-types";
export declare function toProviderAvailability(config: InstallConfig): ProviderAvailability;
export declare function isProviderAvailable(provider: string, availability: ProviderAvailability): boolean;
