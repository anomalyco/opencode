export declare function buildRetryModelPayload(model: string, agentSettings?: {
    variant?: string;
    reasoningEffort?: string;
}): {
    model: {
        providerID: string;
        modelID: string;
    };
    variant?: string;
    reasoningEffort?: string;
} | undefined;
