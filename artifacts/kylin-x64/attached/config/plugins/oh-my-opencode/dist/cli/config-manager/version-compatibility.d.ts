export interface VersionCompatibility {
    canUpgrade: boolean;
    reason?: string;
    isDowngrade: boolean;
    isMajorBump: boolean;
    requiresMigration: boolean;
}
export declare function checkVersionCompatibility(currentVersion: string | null, newVersion: string): VersionCompatibility;
export declare function extractVersionFromPluginEntry(entry: string): string | null;
