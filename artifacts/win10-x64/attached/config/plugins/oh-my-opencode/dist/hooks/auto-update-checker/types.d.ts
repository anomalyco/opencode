import type { ModelCapabilitiesConfig } from "../../config/schema/model-capabilities";
export interface NpmDistTags {
    latest: string;
    [key: string]: string;
}
export interface OpencodeConfig {
    plugin?: string[];
    [key: string]: unknown;
}
export interface PackageJson {
    version: string;
    name?: string;
    [key: string]: unknown;
}
export interface UpdateCheckResult {
    needsUpdate: boolean;
    currentVersion: string | null;
    latestVersion: string | null;
    isLocalDev: boolean;
    isPinned: boolean;
}
export interface AutoUpdateCheckerOptions {
    showStartupToast?: boolean;
    isSisyphusEnabled?: boolean;
    autoUpdate?: boolean;
    modelCapabilities?: ModelCapabilitiesConfig;
}
