import type { PluginInput } from "@opencode-ai/plugin";
import type { PluginConfig } from "../types";
export declare function createToolExecuteBeforeHandler(ctx: PluginInput, config: PluginConfig): (input: {
    tool: string;
    sessionID: string;
    callID: string;
}, output: {
    args: Record<string, unknown>;
}) => Promise<void>;
