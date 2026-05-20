import { loadPluginConfig } from "../plugin-config";
import { refreshModelCapabilitiesCache } from "../shared/model-capabilities-cache";
export type RefreshModelCapabilitiesOptions = {
    directory?: string;
    json?: boolean;
    sourceUrl?: string;
};
type RefreshModelCapabilitiesDeps = {
    loadConfig?: typeof loadPluginConfig;
    refreshCache?: typeof refreshModelCapabilitiesCache;
    stdout?: Pick<typeof process.stdout, "write">;
    stderr?: Pick<typeof process.stderr, "write">;
};
export declare function refreshModelCapabilities(options: RefreshModelCapabilitiesOptions, deps?: RefreshModelCapabilitiesDeps): Promise<number>;
export {};
