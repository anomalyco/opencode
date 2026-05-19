export type ChatParamsInput = {
    sessionID: string;
    agent: {
        name?: string;
    };
    model: {
        providerID: string;
        modelID: string;
    };
    provider: {
        id: string;
    };
    message: {
        variant?: string;
    };
};
type ChatParamsHookInput = ChatParamsInput & {
    rawMessage?: Record<string, unknown>;
};
export type ChatParamsOutput = {
    temperature?: number;
    topP?: number;
    topK?: number;
    maxOutputTokens?: number;
    options: Record<string, unknown>;
};
export declare function createChatParamsHandler(args: {
    anthropicEffort: {
        "chat.params"?: (input: ChatParamsHookInput, output: ChatParamsOutput) => Promise<void>;
    } | null;
    client?: unknown;
}): (input: unknown, output: unknown) => Promise<void>;
export {};
