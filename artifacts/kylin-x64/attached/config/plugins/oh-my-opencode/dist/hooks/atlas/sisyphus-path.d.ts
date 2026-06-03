/**
 * Cross-platform check if a path is inside .sisyphus/ directory.
 * Handles both forward slashes (Unix) and backslashes (Windows).
 * Uses path segment matching (not substring) to avoid false positives like "not-sisyphus/file.txt"
 */
export declare function isSisyphusPath(filePath: string): boolean;
