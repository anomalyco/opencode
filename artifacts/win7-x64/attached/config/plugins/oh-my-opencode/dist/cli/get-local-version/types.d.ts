export interface VersionInfo {
    currentVersion: string | null;
    latestVersion: string | null;
    isUpToDate: boolean;
    isLocalDev: boolean;
    isPinned: boolean;
    pinnedVersion: string | null;
    status: "up-to-date" | "outdated" | "local-dev" | "pinned" | "error" | "unknown";
}
export interface GetLocalVersionOptions {
    directory?: string;
    json?: boolean;
}
