import { getMessageDir, isSqliteBackend, normalizeSDKResponse } from "../../shared";
import { hasCompactionPartInStorage, isCompactionMessage } from "../../shared/compaction-marker";
type SessionLastAgentDeps = {
    getMessageDir: typeof getMessageDir;
    isSqliteBackend: typeof isSqliteBackend;
    normalizeSDKResponse: typeof normalizeSDKResponse;
    hasCompactionPartInStorage: typeof hasCompactionPartInStorage;
    isCompactionMessage: typeof isCompactionMessage;
};
type SessionMessagesClient = {
    session: {
        messages: (input: {
            path: {
                id: string;
            };
        }) => Promise<unknown>;
    };
};
export declare function getLastAgentFromSession(sessionID: string, client?: SessionMessagesClient, deps?: Partial<SessionLastAgentDeps>): Promise<string | null>;
export {};
