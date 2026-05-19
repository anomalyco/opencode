export interface LoadedVersionInfo {
    cacheDir: string;
    cachePackagePath: string;
    installedPackagePath: string;
    expectedVersion: string | null;
    loadedVersion: string | null;
}
export declare function getLoadedPluginVersion(): LoadedVersionInfo;
export declare function getLatestPluginVersion(currentVersion: string | null): Promise<string | null>;
export declare function getSuggestedInstallTag(currentVersion: string | null): string;
