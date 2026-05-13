import type { BackgroundManager } from "../../features/background-agent";
import type { PluginInput } from "@opencode-ai/plugin";
import type { CallOmoAgentArgs } from "./types";
import type { ToolContextWithMetadata } from "./tool-context-with-metadata";
export declare function executeBackgroundAgent(args: CallOmoAgentArgs, toolContext: ToolContextWithMetadata, manager: BackgroundManager, client: PluginInput["client"]): Promise<string>;
