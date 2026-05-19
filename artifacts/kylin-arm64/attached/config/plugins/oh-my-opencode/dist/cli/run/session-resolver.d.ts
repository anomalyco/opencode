import type { OpencodeClient } from "./types";
export declare function resolveSession(options: {
    client: OpencodeClient;
    sessionId?: string;
    directory: string;
}): Promise<string>;
