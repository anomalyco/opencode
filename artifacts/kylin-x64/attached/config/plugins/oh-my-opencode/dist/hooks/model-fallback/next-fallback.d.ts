import type { ModelFallbackState } from "./hook";
export declare function getNextReachableFallback(sessionID: string, state: ModelFallbackState): {
    providerID: string;
    modelID: string;
    variant?: string;
    reasoningEffort?: string;
    temperature?: number;
    top_p?: number;
    maxTokens?: number;
    thinking?: {
        type: "enabled" | "disabled";
        budgetTokens?: number;
    };
} | null;
