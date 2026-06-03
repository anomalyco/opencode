import type { PluginInput } from "@opencode-ai/plugin";
import type { PluginConfig } from "../types";
import type { ContextCollector } from "../../../features/context-injector";
export declare function createChatMessageHandler(ctx: PluginInput, config: PluginConfig, contextCollector?: ContextCollector): (input: {
    sessionID: string;
    agent?: string;
    model?: {
        providerID: string;
        modelID: string;
    };
    messageID?: string;
}, output: {
    message: Record<string, unknown>;
    parts: Array<{
        type: string;
        text?: string;
        [key: string]: unknown;
    }>;
}) => Promise<void>;
