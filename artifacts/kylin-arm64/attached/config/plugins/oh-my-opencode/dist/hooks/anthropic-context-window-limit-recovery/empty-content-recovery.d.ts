import type { AutoCompactState } from "./types";
import type { Client } from "./client";
export declare function fixEmptyMessages(params: {
    sessionID: string;
    autoCompactState: AutoCompactState;
    client: Client;
    messageIndex?: number;
}): Promise<boolean>;
