/**
 * Atlas - Master Orchestrator Agent
 *
 * Orchestrates work via task() to complete ALL tasks in a todo list until fully done.
 * You are the conductor of a symphony of specialized agents.
 *
 * Routing:
 * 1. GPT models (openai/*, github-copilot/gpt-*) → gpt.ts (GPT-5.4 optimized)
 * 2. Gemini models (google/*, google-vertex/*) → gemini.ts (Gemini-optimized)
 * 3. Default (Claude, etc.) → default.ts (Claude-optimized)
 */
import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentPromptMetadata } from "../types";
import type { AvailableAgent, AvailableSkill } from "../dynamic-agent-prompt-builder";
import type { CategoryConfig } from "../../config/schema";
export type AtlasPromptSource = "default" | "gpt" | "gemini";
/**
 * Determines which Atlas prompt to use based on model.
 */
export declare function getAtlasPromptSource(model?: string): AtlasPromptSource;
export interface OrchestratorContext {
    model?: string;
    availableAgents?: AvailableAgent[];
    availableSkills?: AvailableSkill[];
    userCategories?: Record<string, CategoryConfig>;
}
/**
 * Gets the appropriate Atlas prompt based on model.
 */
export declare function getAtlasPrompt(model?: string): string;
export declare function createAtlasAgent(ctx: OrchestratorContext): AgentConfig;
export declare namespace createAtlasAgent {
    var mode: "primary";
}
export declare const atlasPromptMetadata: AgentPromptMetadata;
