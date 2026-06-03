import type { CategoryConfig } from "../config/schema";
type PrometheusOverride = Record<string, unknown> & {
    category?: string;
    model?: string;
    variant?: string;
    reasoningEffort?: string;
    textVerbosity?: string;
    thinking?: {
        type: string;
        budgetTokens?: number;
    };
    temperature?: number;
    top_p?: number;
    maxTokens?: number;
    prompt_append?: string;
};
export declare function buildPrometheusAgentConfig(params: {
    configAgentPlan: Record<string, unknown> | undefined;
    pluginPrometheusOverride: PrometheusOverride | undefined;
    userCategories: Record<string, CategoryConfig> | undefined;
    currentModel: string | undefined;
    disabledTools?: readonly string[];
}): Promise<Record<string, unknown>>;
export {};
