import type { FallbackEntry } from "../../shared/model-requirements";
export declare function resolveModelForDelegateTask(input: {
    userModel?: string;
    userFallbackModels?: string[];
    categoryDefaultModel?: string;
    isUserConfiguredCategoryModel?: boolean;
    fallbackChain?: FallbackEntry[];
    availableModels: Set<string>;
    systemDefaultModel?: string;
}): {
    model: string;
    variant?: string;
    fallbackEntry?: FallbackEntry;
    matchedFallback?: boolean;
} | {
    skipped: true;
} | undefined;
