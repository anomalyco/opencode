import type { BackgroundTaskStatus } from "./types";
export interface TaskHistoryEntry {
    id: string;
    sessionID?: string;
    agent: string;
    description: string;
    status: BackgroundTaskStatus;
    category?: string;
    startedAt?: Date;
    completedAt?: Date;
}
export declare class TaskHistory {
    private entries;
    record(parentSessionID: string | undefined, entry: TaskHistoryEntry): void;
    getByParentSession(parentSessionID: string): TaskHistoryEntry[];
    clearSession(parentSessionID: string): void;
    clearAll(): void;
    formatForCompaction(parentSessionID: string): string | null;
}
