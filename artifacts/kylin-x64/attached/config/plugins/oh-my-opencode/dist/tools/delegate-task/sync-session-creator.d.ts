import type { OpencodeClient } from "./types";
export declare function createSyncSession(client: OpencodeClient, input: {
    parentSessionID: string;
    agentToUse: string;
    description: string;
    defaultDirectory: string;
}): Promise<{
    ok: true;
    sessionID: string;
    parentDirectory: string;
} | {
    ok: false;
    error: string;
}>;
