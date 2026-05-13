export type FallbackEntry = {
    providers: string[];
    model: string;
    variant?: string;
    reasoningEffort?: string;
    temperature?: number;
    top_p?: number;
    maxTokens?: number;
    thinking?: {
        type: "enabled" | "disabled";
        budgetTokens?: number;
    };
};
export type ModelRequirement = {
    fallbackChain: FallbackEntry[];
    variant?: string;
    requiresModel?: string;
    requiresAnyModel?: boolean;
    requiresProvider?: string[];
};
export declare const AGENT_MODEL_REQUIREMENTS: Record<string, ModelRequirement>;
export declare const CATEGORY_MODEL_REQUIREMENTS: Record<string, ModelRequirement>;
