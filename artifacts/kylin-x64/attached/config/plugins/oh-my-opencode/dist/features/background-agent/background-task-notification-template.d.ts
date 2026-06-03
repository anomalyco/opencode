import type { BackgroundTaskStatus } from "./types";
export type BackgroundTaskNotificationStatus = "COMPLETED" | "CANCELLED" | "INTERRUPTED" | "ERROR";
export interface BackgroundTaskNotificationTask {
    id: string;
    description: string;
    status: BackgroundTaskStatus;
    error?: string;
}
export declare function buildBackgroundTaskNotificationText(input: {
    task: BackgroundTaskNotificationTask;
    duration: string;
    statusText: BackgroundTaskNotificationStatus;
    allComplete: boolean;
    remainingCount: number;
    completedTasks: BackgroundTaskNotificationTask[];
}): string;
