export interface MigrationResult {
    migrated: boolean;
    from: string | null;
    to: string | null;
    configPath: string | null;
}
export declare function autoMigrateLegacyPluginEntry(overrideConfigDir?: string): MigrationResult;
