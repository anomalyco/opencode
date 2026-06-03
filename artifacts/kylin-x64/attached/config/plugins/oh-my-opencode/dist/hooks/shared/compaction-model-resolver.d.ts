import type { OhMyOpenCodeConfig } from "../../config";
export declare function resolveCompactionModel(pluginConfig: OhMyOpenCodeConfig, sessionID: string, originalProviderID: string, originalModelID: string): {
    providerID: string;
    modelID: string;
};
