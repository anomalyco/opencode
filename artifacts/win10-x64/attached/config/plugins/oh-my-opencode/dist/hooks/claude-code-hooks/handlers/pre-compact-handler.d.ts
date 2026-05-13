import type { PluginInput } from "@opencode-ai/plugin";
import type { PluginConfig } from "../types";
export declare function createPreCompactHandler(ctx: PluginInput, config: PluginConfig): (input: {
    sessionID: string;
}, output: {
    context: string[];
}) => Promise<void>;
