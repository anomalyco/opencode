import type { ToolContextWithMetadata, OpencodeClient } from "./types";
import type { SessionMessage } from "./executor-types";
export declare function isSessionComplete(messages: SessionMessage[]): boolean;
export declare function pollSyncSession(ctx: ToolContextWithMetadata, client: OpencodeClient, input: {
    sessionID: string;
    agentToUse: string;
    toastManager: {
        removeTask: (id: string) => void;
    } | null | undefined;
    taskId: string | undefined;
    anchorMessageCount?: number;
    maxAssistantTurns?: number;
}, timeoutMs?: number): Promise<string | null>;
