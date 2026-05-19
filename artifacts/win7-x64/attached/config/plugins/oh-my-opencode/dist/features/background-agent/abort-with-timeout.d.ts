import type { OpencodeClient } from "./opencode-client";
export declare function abortWithTimeout(client: OpencodeClient, sessionID: string, timeoutMs?: number): Promise<boolean>;
