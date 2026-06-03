import type { HookDeps } from "./types";
export declare function createChatMessageHandler(deps: HookDeps): (input: {
    sessionID: string;
    agent?: string;
    model?: {
        providerID: string;
        modelID: string;
    };
}, output: {
    message: {
        model?: {
            providerID: string;
            modelID: string;
        };
    };
    parts?: Array<{
        type: string;
        text?: string;
    }>;
}) => Promise<void>;
