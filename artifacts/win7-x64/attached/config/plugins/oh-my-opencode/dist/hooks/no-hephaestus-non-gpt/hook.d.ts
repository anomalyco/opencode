import type { PluginInput } from "@opencode-ai/plugin";
type NoHephaestusNonGptHookOptions = {
    allowNonGptModel?: boolean;
};
export declare function createNoHephaestusNonGptHook(ctx: PluginInput, options?: NoHephaestusNonGptHookOptions): {
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
export {};
