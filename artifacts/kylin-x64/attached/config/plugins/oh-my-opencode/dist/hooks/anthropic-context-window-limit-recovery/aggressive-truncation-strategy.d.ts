import type { AutoCompactState } from "./types";
import type { Client } from "./client";
export declare function runAggressiveTruncationStrategy(params: {
    sessionID: string;
    autoCompactState: AutoCompactState;
    client: Client;
    directory: string;
    truncateAttempt: number;
    currentTokens: number;
    maxTokens: number;
}): Promise<{
    handled: boolean;
    nextTruncateAttempt: number;
}>;
