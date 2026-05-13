import type { RuleFileCandidate } from "./types";
export interface FindRuleFilesOptions {
    /**
     * When true, skip loading rules from ~/.claude/rules/.
     * Use when claude_code integration is disabled to prevent
     * Claude Code-specific instructions from leaking into non-Claude agents.
     */
    skipClaudeUserRules?: boolean;
}
/**
 * Find all rule files for a given context.
 * Searches from currentFile upward to projectRoot for rule directories,
 * then user-level directory (~/.claude/rules).
 *
 * IMPORTANT: This searches EVERY directory from file to project root.
 * Not just the project root itself.
 *
 * @param projectRoot - Project root path (or null if outside any project)
 * @param homeDir - User home directory
 * @param currentFile - Current file being edited (for distance calculation)
 * @returns Array of rule file candidates sorted by distance
 */
export declare function findRuleFiles(projectRoot: string | null, homeDir: string, currentFile: string, options?: FindRuleFilesOptions): RuleFileCandidate[];
