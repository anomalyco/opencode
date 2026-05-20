import { type PluginInput, type ToolDefinition } from "@opencode-ai/plugin";
import type { BackgroundManager } from "../../features/background-agent";
export declare function createBackgroundTask(manager: BackgroundManager, client: PluginInput["client"]): ToolDefinition;
