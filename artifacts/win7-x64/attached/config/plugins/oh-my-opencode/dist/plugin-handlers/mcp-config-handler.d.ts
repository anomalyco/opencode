import type { OhMyOpenCodeConfig } from "../config";
import type { PluginComponents } from "./plugin-components-loader";
export declare function applyMcpConfig(params: {
    config: Record<string, unknown>;
    pluginConfig: OhMyOpenCodeConfig;
    pluginComponents: PluginComponents;
}): Promise<void>;
