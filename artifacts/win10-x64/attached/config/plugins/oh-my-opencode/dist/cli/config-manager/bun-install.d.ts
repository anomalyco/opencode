type BunInstallOutputMode = "inherit" | "pipe";
interface RunBunInstallOptions {
    outputMode?: BunInstallOutputMode;
    /** Workspace directory to install to. Defaults to cache dir if not provided. */
    workspaceDir?: string;
}
export interface BunInstallResult {
    success: boolean;
    timedOut?: boolean;
    error?: string;
}
export declare function runBunInstall(): Promise<boolean>;
export declare function runBunInstallWithDetails(options?: RunBunInstallOptions): Promise<BunInstallResult>;
export {};
