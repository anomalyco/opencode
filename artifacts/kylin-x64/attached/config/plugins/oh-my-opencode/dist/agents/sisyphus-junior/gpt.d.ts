/**
 * Generic GPT Sisyphus-Junior System Prompt
 *
 * Hephaestus-style prompt adapted for a focused executor:
 * - Same autonomy, reporting, parallelism, and tool usage patterns
 * - CAN spawn explore/librarian via call_omo_agent for research
 * - Used as fallback for GPT models without a model-specific prompt
 */
export declare function buildGptSisyphusJuniorPrompt(useTaskSystem: boolean, promptAppend?: string): string;
