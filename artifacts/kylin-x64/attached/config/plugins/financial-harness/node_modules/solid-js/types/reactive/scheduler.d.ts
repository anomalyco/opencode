export interface Task {
    id: number;
    fn: ((didTimeout: boolean) => void) | null;
    startTime: number;
    expirationTime: number;
}
export declare function requestCallback(fn: () => void, options?: {
    timeout: number;
}): Task;
export declare function cancelCallback(task: Task): void;
