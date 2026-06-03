import type { PluginEntryInfo } from "./plugin-entry";
export interface SyncResult {
    synced: boolean;
    error: "parse_error" | "write_error" | null;
    message?: string;
}
export declare function syncCachePackageJsonToIntent(pluginInfo: PluginEntryInfo): SyncResult;
