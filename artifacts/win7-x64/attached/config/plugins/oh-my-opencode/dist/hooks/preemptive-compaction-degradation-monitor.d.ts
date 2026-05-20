import type { OhMyOpenCodeConfig } from "../config";
interface CompactionTargetState {
    providerID: string;
    modelID: string;
}
interface ClientLike {
    session: {
        summarize: (input: {
            path: {
                id: string;
            };
            body: {
                providerID: string;
                modelID: string;
            };
            query: {
                directory: string;
            };
        }) => Promise<unknown>;
        messages: (input: {
            path: {
                id: string;
            };
            query?: {
                directory: string;
            };
        }) => Promise<unknown>;
    };
    tui: {
        showToast: (input: {
            body: {
                title: string;
                message: string;
                variant: "warning";
                duration: number;
            };
        }) => Promise<unknown>;
    };
}
export interface AssistantCompactionMessageInfo {
    sessionID: string;
    id?: string;
}
export declare function createPostCompactionDegradationMonitor(args: {
    client: ClientLike;
    directory: string;
    pluginConfig: OhMyOpenCodeConfig;
    tokenCache: Map<string, CompactionTargetState>;
    compactionInProgress: Set<string>;
}): {
    clear: (sessionID: string) => void;
    onSessionCompacted: (sessionID: string) => void;
    onAssistantMessageUpdated: (info: AssistantCompactionMessageInfo) => Promise<void>;
};
export {};
