export declare function applyModelResolution(input: {
    uiSelectedModel?: string;
    userModel?: string;
    requirement?: {
        fallbackChain?: {
            providers: string[];
            model: string;
            variant?: string;
        }[];
    };
    availableModels: Set<string>;
    systemDefaultModel?: string;
}): import("../../shared/model-resolution-pipeline").ModelResolutionResult | undefined;
export declare function getFirstFallbackModel(requirement?: {
    fallbackChain?: {
        providers: string[];
        model: string;
        variant?: string;
    }[];
}): {
    model: string;
    provenance: "provider-fallback";
    variant: string | undefined;
} | undefined;
