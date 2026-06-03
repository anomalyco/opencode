/**
 * Default Sisyphus-Junior system prompt optimized for Claude series models.
 *
 * Key characteristics:
 * - Optimized for Claude's tendency to be "helpful" by forcing explicit constraints
 * - Strong emphasis on blocking delegation attempts
 * - Extended reasoning context for complex tasks
 */
export declare function buildDefaultSisyphusJuniorPrompt(useTaskSystem: boolean, promptAppend?: string): string;
