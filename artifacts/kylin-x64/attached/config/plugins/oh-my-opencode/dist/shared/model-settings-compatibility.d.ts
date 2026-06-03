type CompatibilityField = "variant" | "reasoningEffort" | "temperature" | "topP" | "maxTokens" | "thinking";
type DesiredModelSettings = {
    variant?: string;
    reasoningEffort?: string;
    temperature?: number;
    topP?: number;
    maxTokens?: number;
    thinking?: Record<string, unknown>;
};
type CompatibilityCapabilities = {
    variants?: string[];
    reasoningEfforts?: string[];
    supportsTemperature?: boolean;
    supportsTopP?: boolean;
    maxOutputTokens?: number;
    supportsThinking?: boolean;
};
export type ModelSettingsCompatibilityInput = {
    providerID: string;
    modelID: string;
    desired: DesiredModelSettings;
    capabilities?: CompatibilityCapabilities;
};
export type ModelSettingsCompatibilityChange = {
    field: CompatibilityField;
    from: string;
    to?: string;
    reason: "unsupported-by-model-family" | "unknown-model-family" | "unsupported-by-model-metadata" | "max-output-limit";
};
export type ModelSettingsCompatibilityResult = {
    variant?: string;
    reasoningEffort?: string;
    temperature?: number;
    topP?: number;
    maxTokens?: number;
    thinking?: Record<string, unknown>;
    changes: ModelSettingsCompatibilityChange[];
};
export declare function resolveCompatibleModelSettings(input: ModelSettingsCompatibilityInput): ModelSettingsCompatibilityResult;
export {};
