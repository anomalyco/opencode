import type { RuleMetadata } from "./types";
export interface RuleFrontmatterResult {
    metadata: RuleMetadata;
    body: string;
}
/**
 * Parse YAML frontmatter from rule file content
 * Supports:
 * - Single string: globs: "**\/*.py"
 * - Inline array: globs: ["**\/*.py", "src/**\/*.ts"]
 * - Multi-line array:
 *   globs:
 *     - "**\/*.py"
 *     - "src/**\/*.ts"
 * - Comma-separated: globs: "**\/*.py, src/**\/*.ts"
 * - Claude Code 'paths' field (alias for globs)
 */
export declare function parseRuleFrontmatter(content: string): RuleFrontmatterResult;
