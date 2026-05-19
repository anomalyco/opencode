import type { OpencodeClient } from "../constants";
export declare function resolveParentDirectory(options: {
    client: OpencodeClient;
    parentSessionID: string;
    defaultDirectory: string;
}): Promise<string>;
