import type { PluginInput } from "@opencode-ai/plugin";
import { type ToolDefinition } from "@opencode-ai/plugin/tool";
import type { OhMyOpenCodeConfig } from "../../config/schema";
export declare function createTaskUpdateTool(config: Partial<OhMyOpenCodeConfig>, ctx?: PluginInput): ToolDefinition;
