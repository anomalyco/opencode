import type { createOpencodeClient } from "@opencode-ai/sdk";
import { type PromptRetryOptions } from "./prompt-timeout-context";
type Client = ReturnType<typeof createOpencodeClient>;
export interface ModelSuggestionInfo {
    providerID: string;
    modelID: string;
    suggestion: string;
}
export declare function parseModelSuggestion(error: unknown): ModelSuggestionInfo | null;
interface PromptBody {
    model?: {
        providerID: string;
        modelID: string;
    };
    [key: string]: unknown;
}
interface PromptArgs {
    path: {
        id: string;
    };
    body: PromptBody;
    signal?: AbortSignal;
    [key: string]: unknown;
}
export declare function promptWithModelSuggestionRetry(client: Client, args: PromptArgs, options?: PromptRetryOptions): Promise<void>;
export declare function promptSyncWithModelSuggestionRetry(client: Client, args: PromptArgs, options?: PromptRetryOptions): Promise<void>;
export {};
