interface ChatParamsInput {
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
}
interface ChatParamsOutput {
    temperature?: number;
    topP?: number;
    topK?: number;
    options: Record<string, unknown>;
}
export declare function createAnthropicEffortHook(): {
    "chat.params": (input: ChatParamsInput, output: ChatParamsOutput) => Promise<void>;
};
export {};
