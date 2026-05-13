import type { CallOmoAgentArgs } from "./types";
import type { PluginInput } from "@opencode-ai/plugin";
export declare function createOrGetSession(args: CallOmoAgentArgs, toolContext: {
    sessionID: string;
    messageID: string;
    agent: string;
    abort: AbortSignal;
    metadata?: (input: {
        title?: string;
        metadata?: Record<string, unknown>;
    }) => void;
}, ctx: PluginInput): Promise<{
    sessionID: string;
    isNew: boolean;
}>;
