/**
 * Generic processing queue that handles asynchronous job processing
 */
export declare class ProcessQueue<T> {
    private processor;
    private queue;
    private processing;
    private autoProcess;
    constructor(processor: (item: T) => Promise<void> | void, autoProcess?: boolean);
    enqueue(item: T): void;
    private processQueue;
    clear(): void;
    isProcessing(): boolean;
    size(): number;
}
