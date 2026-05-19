type PromptParamModel = {
    temperature?: number;
    top_p?: number;
    reasoningEffort?: string;
    maxTokens?: number;
    thinking?: {
        type: "enabled" | "disabled";
        budgetTokens?: number;
    };
};
export declare function applySessionPromptParams(sessionID: string, model: PromptParamModel | undefined): void;
export {};
