export interface LegacyPluginCheckResult {
    hasLegacyEntry: boolean;
    hasCanonicalEntry: boolean;
    legacyEntries: string[];
    configPath: string | null;
}
export declare function checkForLegacyPluginEntry(overrideConfigDir?: string): LegacyPluginCheckResult;
