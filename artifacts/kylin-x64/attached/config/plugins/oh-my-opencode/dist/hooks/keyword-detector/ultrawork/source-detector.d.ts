/**
 * Agent/model detection utilities for ultrawork message routing.
 *
 * Routing logic:
 * 1. Planner agents (prometheus, plan) → planner.ts
 * 2. GPT 5.4 models → gpt5.4.ts
 * 3. Gemini models → gemini.ts
 * 4. Everything else (Claude, etc.) → default.ts
 */
import { isGptModel, isGeminiModel } from "../../../agents/types";
/**
 * Checks if agent is a planner-type agent.
 * Planners don't need ultrawork injection (they ARE the planner).
 */
export declare function isPlannerAgent(agentName?: string): boolean;
/**
 * Checks if agent is a non-OMO agent (e.g., OpenCode's built-in Builder/Plan).
 * Non-OMO agents should not receive keyword injection (search-mode, analyze-mode, etc.).
 */
export declare function isNonOmoAgent(agentName?: string): boolean;
export { isGptModel, isGeminiModel };
/** Ultrawork message source type */
export type UltraworkSource = "planner" | "gpt" | "gemini" | "default";
/**
 * Determines which ultrawork message source to use.
 */
export declare function getUltraworkSource(agentName?: string, modelID?: string): UltraworkSource;
