export interface PluginInfo {
    registered: boolean;
    configPath: string | null;
    entry: string | null;
    isPinned: boolean;
    pinnedVersion: string | null;
    isLocalDev: boolean;
}
declare function detectConfigPath(): string | null;
declare function findPluginEntry(entries: string[]): {
    entry: string;
    isLocalDev: boolean;
} | null;
export declare function getPluginInfo(): PluginInfo;
export { detectConfigPath, findPluginEntry };
