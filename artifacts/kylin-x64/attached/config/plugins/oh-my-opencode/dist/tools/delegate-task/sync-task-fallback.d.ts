import type { FallbackEntry } from "../../shared/model-requirements";
import type { DelegatedModelConfig } from "./types";
export declare function retrySyncPromptWithFallbacks(input: {
    sessionID: string;
    initialError: string;
    categoryModel: DelegatedModelConfig | undefined;
    fallbackChain: FallbackEntry[] | undefined;
    sendPrompt: (categoryModel: DelegatedModelConfig) => Promise<string | null>;
}): Promise<{
    promptError: string | null;
    categoryModel: DelegatedModelConfig | undefined;
}>;
