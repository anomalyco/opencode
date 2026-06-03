export declare function getCacheDir(): string;
export declare function getBinaryName(): string;
export declare function getCachedBinaryPath(): string | null;
export declare function downloadAstGrep(version?: string): Promise<string | null>;
export declare function ensureAstGrepBinary(): Promise<string | null>;
