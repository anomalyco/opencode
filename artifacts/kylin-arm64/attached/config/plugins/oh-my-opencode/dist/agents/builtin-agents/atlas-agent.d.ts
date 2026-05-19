import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentOverrides } from "../types";
import type { CategoriesConfig, CategoryConfig } from "../../config/schema";
import type { AvailableAgent, AvailableSkill } from "../dynamic-agent-prompt-builder";
export declare function maybeCreateAtlasConfig(input: {
    disabledAgents: string[];
    agentOverrides: AgentOverrides;
    uiSelectedModel?: string;
    availableModels: Set<string>;
    systemDefaultModel?: string;
    availableAgents: AvailableAgent[];
    availableSkills: AvailableSkill[];
    mergedCategories: Record<string, CategoryConfig>;
    directory?: string;
    userCategories?: CategoriesConfig;
    useTaskSystem?: boolean;
}): AgentConfig | undefined;
