import type { AgentConfig } from "@opencode-ai/sdk";
import type { BuiltinAgentName, AgentOverrides, AgentPromptMetadata } from "../types";
import type { CategoryConfig, GitMasterConfig } from "../../config/schema";
import type { BrowserAutomationProvider } from "../../config/schema";
import type { AvailableAgent } from "../dynamic-agent-prompt-builder";
export declare function collectPendingBuiltinAgents(input: {
    agentSources: Record<BuiltinAgentName, import("../agent-builder").AgentSource>;
    agentMetadata: Partial<Record<BuiltinAgentName, AgentPromptMetadata>>;
    disabledAgents: string[];
    agentOverrides: AgentOverrides;
    directory?: string;
    systemDefaultModel?: string;
    mergedCategories: Record<string, CategoryConfig>;
    gitMasterConfig?: GitMasterConfig;
    browserProvider?: BrowserAutomationProvider;
    uiSelectedModel?: string;
    availableModels: Set<string>;
    isFirstRunNoCache: boolean;
    disabledSkills?: Set<string>;
    useTaskSystem?: boolean;
    disableOmoEnv?: boolean;
}): {
    pendingAgentConfigs: Map<string, AgentConfig>;
    availableAgents: AvailableAgent[];
};
