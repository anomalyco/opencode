import type { OhMyOpenCodeConfig } from "../config";
import type { PluginComponents } from "./plugin-components-loader";
export declare function applyCommandConfig(params: {
    config: Record<string, unknown>;
    pluginConfig: OhMyOpenCodeConfig;
    ctx: {
        directory: string;
    };
    pluginComponents: PluginComponents;
}): Promise<void>;
