import type { PendingTaskRef, TrackedTopLevelTaskRef } from "./types";
export declare function resolvePreferredSessionId(currentSessionId?: string, trackedSessionId?: string): string;
export declare function resolveTaskContext(pendingTaskRef: PendingTaskRef | undefined, planPath: string): {
    currentTask: TrackedTopLevelTaskRef | null;
    shouldSkipTaskSessionUpdate: boolean;
    shouldIgnoreCurrentSessionId: boolean;
};
