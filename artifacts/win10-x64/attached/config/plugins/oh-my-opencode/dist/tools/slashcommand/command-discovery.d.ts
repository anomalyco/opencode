import type { CommandInfo } from "./types";
export interface CommandDiscoveryOptions {
    pluginsEnabled?: boolean;
    enabledPluginsOverride?: Record<string, boolean>;
}
export declare function discoverCommandsSync(directory?: string, options?: CommandDiscoveryOptions): CommandInfo[];
