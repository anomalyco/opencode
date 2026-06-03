import type { OhMyOpenCodeConfig } from "../../config";
type ResolveFallbackBootstrapModelOptions = {
    sessionID: string;
    source: string;
    eventModel?: string;
    resolvedAgent?: string;
    pluginConfig?: OhMyOpenCodeConfig;
};
export declare function resolveFallbackBootstrapModel(options: ResolveFallbackBootstrapModelOptions): string | undefined;
export {};
