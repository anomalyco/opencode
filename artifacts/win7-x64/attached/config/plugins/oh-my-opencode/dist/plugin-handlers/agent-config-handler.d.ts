import type { OhMyOpenCodeConfig } from "../config";
import type { PluginComponents } from "./plugin-components-loader";
export declare function applyAgentConfig(params: {
    config: Record<string, unknown>;
    pluginConfig: OhMyOpenCodeConfig;
    ctx: {
        directory: string;
        client?: any;
    };
    pluginComponents: PluginComponents;
}): Promise<Record<string, unknown>>;
