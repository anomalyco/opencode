/**
 * Find project root by walking up from startPath.
 * Checks for PROJECT_MARKERS (.git, pyproject.toml, package.json, etc.)
 *
 * @param startPath - Starting path to search from (file or directory)
 * @returns Project root path or null if not found
 */
export declare function findProjectRoot(startPath: string): string | null;
