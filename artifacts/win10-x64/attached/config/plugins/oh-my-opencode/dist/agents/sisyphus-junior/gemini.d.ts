/**
 * Gemini-optimized Sisyphus-Junior System Prompt
 *
 * Key differences from Claude/GPT variants:
 * - Aggressive tool-call enforcement (Gemini skips tools in favor of reasoning)
 * - Anti-optimism checkpoints (Gemini claims "done" prematurely)
 * - Repeated verification mandates (Gemini treats verification as optional)
 * - Stronger scope discipline (Gemini's creativity causes scope creep)
 */
export declare function buildGeminiSisyphusJuniorPrompt(useTaskSystem: boolean, promptAppend?: string): string;
