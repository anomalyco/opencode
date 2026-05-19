import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentOverrides } from "../types";
import type { CategoryConfig } from "../../config/schema";
import type { AvailableAgent, AvailableCategory, AvailableSkill } from "../dynamic-agent-prompt-builder";
export declare function maybeCreateHephaestusConfig(input: {
    disabledAgents: string[];
    agentOverrides: AgentOverrides;
    availableModels: Set<string>;
    systemDefaultModel?: string;
    isFirstRunNoCache: boolean;
    availableAgents: AvailableAgent[];
    availableSkills: AvailableSkill[];
    availableCategories: AvailableCategory[];
    mergedCategories: Record<string, CategoryConfig>;
    directory?: string;
    useTaskSystem: boolean;
    disableOmoEnv?: boolean;
}): AgentConfig | undefined;
