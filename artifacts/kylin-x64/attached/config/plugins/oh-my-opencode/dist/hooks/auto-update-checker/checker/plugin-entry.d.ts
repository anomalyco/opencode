export interface PluginEntryInfo {
    entry: string;
    isPinned: boolean;
    pinnedVersion: string | null;
    configPath: string;
}
export declare function findPluginEntry(directory: string): PluginEntryInfo | null;
