/**
 * Ultrawork message module - routes to appropriate message based on agent/model.
 *
 * Routing:
 * 1. Planner agents (prometheus, plan) → planner.ts
 * 2. GPT models → gpt.ts
 * 3. Gemini models → gemini.ts
 * 4. Default (Claude, etc.) → default.ts (optimized for Claude series)
 */
export { isPlannerAgent, isNonOmoAgent, isGptModel, isGeminiModel, getUltraworkSource, } from "./source-detector";
export type { UltraworkSource } from "./source-detector";
export { ULTRAWORK_PLANNER_SECTION, getPlannerUltraworkMessage, } from "./planner";
export { ULTRAWORK_GPT_MESSAGE, getGptUltraworkMessage } from "./gpt";
export { ULTRAWORK_GEMINI_MESSAGE, getGeminiUltraworkMessage } from "./gemini";
export { ULTRAWORK_DEFAULT_MESSAGE, getDefaultUltraworkMessage, } from "./default";
/**
 * Gets the appropriate ultrawork message based on agent and model context.
 */
export declare function getUltraworkMessage(agentName?: string, modelID?: string): string;
