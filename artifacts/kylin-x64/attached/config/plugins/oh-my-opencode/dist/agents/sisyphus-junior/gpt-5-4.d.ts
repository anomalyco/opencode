/**
 * GPT-5.4 Optimized Sisyphus-Junior System Prompt
 *
 * Tuned for GPT-5.4 system prompt design principles:
 * - Expert coding agent framing with approach-first mentality
 * - Deterministic tool usage (always/never, not try/maybe)
 * - Prose-first output style
 * - Nuanced autonomy (focus unless directly conflicting)
 * - CAN spawn explore/librarian via call_omo_agent for research
 */
export declare function buildGpt54SisyphusJuniorPrompt(useTaskSystem: boolean, promptAppend?: string): string;
