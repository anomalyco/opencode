import type { PluginInput } from "@opencode-ai/plugin";
export declare function waitForCompletion(sessionID: string, toolContext: {
    sessionID: string;
    messageID: string;
    agent: string;
    abort: AbortSignal;
    metadata?: (input: {
        title?: string;
        metadata?: Record<string, unknown>;
    }) => void;
}, ctx: PluginInput): Promise<void>;
