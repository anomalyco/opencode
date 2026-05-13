import type { PluginInput } from "@opencode-ai/plugin";
import type { PluginConfig } from "../types";
export declare function createToolExecuteAfterHandler(ctx: PluginInput, config: PluginConfig): (input: {
    tool: string;
    sessionID: string;
    callID: string;
}, output: {
    title: string;
    output: string;
    metadata: unknown;
} | undefined) => Promise<void>;
