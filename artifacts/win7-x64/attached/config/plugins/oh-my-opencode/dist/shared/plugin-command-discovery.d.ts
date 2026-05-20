import type { CommandDefinition } from "../features/claude-code-command-loader/types";
export interface PluginCommandDiscoveryOptions {
    pluginsEnabled?: boolean;
    enabledPluginsOverride?: Record<string, boolean>;
}
export declare function discoverPluginCommandDefinitions(options?: PluginCommandDiscoveryOptions): Record<string, CommandDefinition>;
