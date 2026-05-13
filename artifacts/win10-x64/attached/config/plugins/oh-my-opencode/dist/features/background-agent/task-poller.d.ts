import type { BackgroundTaskConfig } from "../../config/schema";
import type { BackgroundTask } from "./types";
import type { ConcurrencyManager } from "./concurrency";
import type { OpencodeClient } from "./opencode-client";
export declare function pruneStaleTasksAndNotifications(args: {
    tasks: Map<string, BackgroundTask>;
    notifications: Map<string, BackgroundTask[]>;
    onTaskPruned: (taskId: string, task: BackgroundTask, errorMessage: string) => void;
    taskTtlMs?: number;
}): void;
export type SessionStatusMap = Record<string, {
    type: string;
}>;
export declare function checkAndInterruptStaleTasks(args: {
    tasks: Iterable<BackgroundTask>;
    client: OpencodeClient;
    directory?: string;
    config: BackgroundTaskConfig | undefined;
    concurrencyManager: ConcurrencyManager;
    notifyParentSession: (task: BackgroundTask) => Promise<void>;
    sessionStatuses?: SessionStatusMap;
    onTaskInterrupted?: (task: BackgroundTask) => void;
}): Promise<void>;
