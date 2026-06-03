import type { OpencodeClient } from "./opencode-client";
export declare const MIN_SESSION_GONE_POLLS = 3;
export declare function verifySessionExists(client: OpencodeClient, sessionID: string, directory?: string): Promise<boolean>;
