import type { PluginInput } from "@opencode-ai/plugin";
export declare function injectContinuationPrompt(ctx: PluginInput, options: {
    sessionID: string;
    prompt: string;
    directory: string;
    apiTimeoutMs: number;
    inheritFromSessionID?: string;
}): Promise<void>;
