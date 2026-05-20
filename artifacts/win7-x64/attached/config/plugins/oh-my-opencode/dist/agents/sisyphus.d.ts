import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentPromptMetadata } from "./types";
export declare const SISYPHUS_PROMPT_METADATA: AgentPromptMetadata;
import type { AvailableAgent, AvailableSkill, AvailableCategory } from "./dynamic-agent-prompt-builder";
export declare function createSisyphusAgent(model: string, availableAgents?: AvailableAgent[], availableToolNames?: string[], availableSkills?: AvailableSkill[], availableCategories?: AvailableCategory[], useTaskSystem?: boolean): AgentConfig;
export declare namespace createSisyphusAgent {
    var mode: "primary";
}
