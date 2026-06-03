import { type PluginInput, type ToolDefinition } from "@opencode-ai/plugin";
import type { BackgroundManager } from "../../features/background-agent";
import type { CategoriesConfig, AgentOverrides } from "../../config/schema";
export declare function createCallOmoAgent(ctx: PluginInput, backgroundManager: BackgroundManager, disabledAgents?: string[], agentOverrides?: AgentOverrides, userCategories?: CategoriesConfig): ToolDefinition;
