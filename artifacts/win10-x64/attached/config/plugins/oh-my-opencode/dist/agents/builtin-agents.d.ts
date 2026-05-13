import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentOverrides } from "./types";
import type { CategoriesConfig, GitMasterConfig } from "../config/schema";
import type { LoadedSkill } from "../features/opencode-skill-loader/types";
import type { BrowserAutomationProvider } from "../config/schema";
export declare function createBuiltinAgents(disabledAgents?: string[], agentOverrides?: AgentOverrides, directory?: string, systemDefaultModel?: string, categories?: CategoriesConfig, gitMasterConfig?: GitMasterConfig, discoveredSkills?: LoadedSkill[], customAgentSummaries?: unknown, browserProvider?: BrowserAutomationProvider, uiSelectedModel?: string, disabledSkills?: Set<string>, useTaskSystem?: boolean, disableOmoEnv?: boolean): Promise<Record<string, AgentConfig>>;
