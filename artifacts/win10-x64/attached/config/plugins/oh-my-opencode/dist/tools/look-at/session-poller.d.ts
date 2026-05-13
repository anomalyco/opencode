import type { createOpencodeClient } from "@opencode-ai/sdk";
type Client = ReturnType<typeof createOpencodeClient>;
export interface PollOptions {
    pollIntervalMs?: number;
    timeoutMs?: number;
}
export declare function pollSessionUntilIdle(client: Client, sessionID: string, options?: PollOptions): Promise<void>;
export {};
