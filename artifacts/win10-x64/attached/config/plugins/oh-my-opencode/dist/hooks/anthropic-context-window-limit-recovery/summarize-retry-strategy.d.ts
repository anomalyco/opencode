import type { AutoCompactState } from "./types";
import type { OhMyOpenCodeConfig } from "../../config";
import type { Client } from "./client";
export declare function runSummarizeRetryStrategy(params: {
    sessionID: string;
    msg: Record<string, unknown>;
    autoCompactState: AutoCompactState;
    client: Client;
    directory: string;
    pluginConfig: OhMyOpenCodeConfig;
    errorType?: string;
    messageIndex?: number;
}): Promise<void>;
