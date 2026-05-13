/**
 * Sisyphus-Junior - Focused Task Executor
 *
 * Executes delegated tasks directly without spawning other agents.
 * Category-spawned executor with domain-specific configurations.
 *
 * Routing:
 * 1. GPT models (openai/*, github-copilot/gpt-*) -> gpt.ts (GPT-5.4 optimized)
 * 2. Gemini models (google/*, google-vertex/*) -> gemini.ts (Gemini-optimized)
 * 3. Default (Claude, etc.) -> default.ts (Claude-optimized)
 */
import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentOverrideConfig } from "../../config/schema";
export declare const SISYPHUS_JUNIOR_DEFAULTS: {
    readonly model: "anthropic/claude-sonnet-4-6";
    readonly temperature: 0.1;
};
export type SisyphusJuniorPromptSource = "default" | "gpt" | "gpt-5-4" | "gpt-5-3-codex" | "gemini";
export declare function getSisyphusJuniorPromptSource(model?: string): SisyphusJuniorPromptSource;
/**
 * Builds the appropriate Sisyphus-Junior prompt based on model.
 */
export declare function buildSisyphusJuniorPrompt(model: string | undefined, useTaskSystem: boolean, promptAppend?: string): string;
export declare function createSisyphusJuniorAgentWithOverrides(override: AgentOverrideConfig | undefined, systemDefaultModel?: string, useTaskSystem?: boolean): AgentConfig;
export declare namespace createSisyphusJuniorAgentWithOverrides {
    var mode: "subagent";
}
