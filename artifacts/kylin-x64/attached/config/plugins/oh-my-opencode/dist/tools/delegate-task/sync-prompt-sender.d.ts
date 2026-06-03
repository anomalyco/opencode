import type { DelegateTaskArgs, OpencodeClient, DelegatedModelConfig } from "./types";
import type { SisyphusAgentConfig } from "../../config/schema";
import { promptSyncWithModelSuggestionRetry, promptWithModelSuggestionRetry } from "../../shared/model-suggestion-retry";
type SendSyncPromptDeps = {
    promptWithModelSuggestionRetry: typeof promptWithModelSuggestionRetry;
    promptSyncWithModelSuggestionRetry: typeof promptSyncWithModelSuggestionRetry;
};
export declare function sendSyncPrompt(client: OpencodeClient, input: {
    sessionID: string;
    agentToUse: string;
    args: DelegateTaskArgs;
    systemContent: string | undefined;
    categoryModel: DelegatedModelConfig | undefined;
    toastManager: {
        removeTask: (id: string) => void;
    } | null | undefined;
    taskId: string | undefined;
    sisyphusAgentConfig?: SisyphusAgentConfig;
}, deps?: SendSyncPromptDeps): Promise<string | null>;
export {};
