import type { PluginInput } from "@opencode-ai/plugin";
export declare function createNoSisyphusGptHook(ctx: PluginInput): {
    "chat.message": (input: {
        sessionID: string;
        agent?: string;
        model?: {
            providerID: string;
            modelID: string;
        };
    }, output?: {
        message?: {
            agent?: string;
            [key: string]: unknown;
        };
    }) => Promise<void>;
};
