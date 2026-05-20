import type { BackgroundTaskStatus } from "./types";
type AbortSignalLike = {
    aborted: boolean;
};
interface TaskReader {
    getTask(taskID: string): {
        sessionID?: string;
        status?: BackgroundTaskStatus;
    } | undefined;
}
export interface WaitForTaskSessionIDOptions {
    timeoutMs?: number;
    intervalMs?: number;
    signal?: AbortSignalLike;
}
export declare function waitForTaskSessionID(manager: TaskReader, taskID: string, options?: WaitForTaskSessionIDOptions): Promise<string | undefined>;
export {};
