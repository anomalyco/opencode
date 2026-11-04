export declare function isBunfsPath(path: string): boolean;
export declare function getBunfsRootPath(): string;
/**
 * Normalizes a path to the embedded root.
 * Flattens directory structure to ensure file exists at root.
 */
export declare function normalizeBunfsPath(fileName: string): string;
