import type { BackgroundTask } from "./types";
import type { ConcurrencyManager } from "./concurrency";
import type { OpencodeClient, QueueItem } from "./constants";
export declare function tryFallbackRetry(args: {
    task: BackgroundTask;
    errorInfo: {
        name?: string;
        message?: string;
    };
    source: string;
    concurrencyManager: ConcurrencyManager;
    client: OpencodeClient;
    idleDeferralTimers: Map<string, ReturnType<typeof setTimeout>>;
    queuesByKey: Map<string, QueueItem[]>;
    processKey: (key: string) => void;
}): Promise<boolean>;
