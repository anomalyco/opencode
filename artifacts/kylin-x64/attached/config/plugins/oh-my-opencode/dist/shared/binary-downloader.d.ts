export declare function getCachedBinaryPath(cacheDir: string, binaryName: string): string | null;
export declare function ensureCacheDir(cacheDir: string): void;
export declare function downloadArchive(downloadUrl: string, archivePath: string): Promise<void>;
export declare function extractTarGz(archivePath: string, destDir: string, options?: {
    args?: string[];
    cwd?: string;
}): Promise<void>;
export declare function extractZipArchive(archivePath: string, destDir: string): Promise<void>;
export declare function cleanupArchive(archivePath: string): void;
export declare function ensureExecutable(binaryPath: string): void;
