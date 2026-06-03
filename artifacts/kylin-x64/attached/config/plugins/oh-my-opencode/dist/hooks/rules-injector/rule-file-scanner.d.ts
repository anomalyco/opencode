/**
 * Recursively find all rule files (*.md, *.mdc) in a directory
 *
 * @param dir - Directory to search
 * @param results - Array to accumulate results
 */
export declare function findRuleFilesRecursive(dir: string, results: string[]): void;
/**
 * Resolve symlinks safely with fallback to original path
 *
 * @param filePath - Path to resolve
 * @returns Real path or original path if resolution fails
 */
export declare function safeRealpathSync(filePath: string): string;
