/**
 * Calculate directory distance between a rule file and current file.
 * Distance is based on common ancestor within project root.
 *
 * @param rulePath - Path to the rule file
 * @param currentFile - Path to the current file being edited
 * @param projectRoot - Project root for relative path calculation
 * @returns Distance (0 = same directory, higher = further)
 */
export declare function calculateDistance(rulePath: string, currentFile: string, projectRoot: string | null): number;
