import type { Client } from "./client";
export declare function fixEmptyMessagesWithSDK(params: {
    sessionID: string;
    client: Client;
    placeholderText: string;
    messageIndex?: number;
}): Promise<{
    fixed: boolean;
    fixedMessageIds: string[];
    scannedEmptyCount: number;
}>;
