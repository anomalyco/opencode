import type { StoredMessage } from "../hook-message-injector";
export { isCompactionAgent } from "../../shared/compaction-marker";
type SessionMessage = {
    id?: string;
    info?: {
        agent?: string;
        model?: {
            providerID?: string;
            modelID?: string;
            variant?: string;
        };
        providerID?: string;
        modelID?: string;
        tools?: StoredMessage["tools"];
    };
    parts?: Array<{
        type?: string;
    }>;
};
export declare function resolvePromptContextFromSessionMessages(messages: SessionMessage[], sessionID?: string): StoredMessage | null;
export declare function findNearestMessageExcludingCompaction(messageDir: string, sessionID?: string): StoredMessage | null;
