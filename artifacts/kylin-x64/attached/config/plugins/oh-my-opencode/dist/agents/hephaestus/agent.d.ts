import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentPromptMetadata } from "../types";
import type { AvailableAgent, AvailableTool, AvailableSkill, AvailableCategory } from "../dynamic-agent-prompt-builder";
export type HephaestusPromptSource = "gpt-5-4" | "gpt-5-3-codex" | "gpt";
export declare function getHephaestusPromptSource(model?: string): HephaestusPromptSource;
export interface HephaestusContext {
    model?: string;
    availableAgents?: AvailableAgent[];
    availableTools?: AvailableTool[];
    availableSkills?: AvailableSkill[];
    availableCategories?: AvailableCategory[];
    useTaskSystem?: boolean;
}
export declare function getHephaestusPrompt(model?: string, useTaskSystem?: boolean): string;
export declare function createHephaestusAgent(model: string, availableAgents?: AvailableAgent[], availableToolNames?: string[], availableSkills?: AvailableSkill[], availableCategories?: AvailableCategory[], useTaskSystem?: boolean): AgentConfig;
export declare namespace createHephaestusAgent {
    var mode: "primary";
}
export declare const hephaestusPromptMetadata: AgentPromptMetadata;
