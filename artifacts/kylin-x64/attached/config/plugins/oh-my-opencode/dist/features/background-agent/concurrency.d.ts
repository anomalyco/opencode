import type { BackgroundTaskConfig } from "../../config/schema";
export declare class ConcurrencyManager {
    private config?;
    private counts;
    private queues;
    constructor(config?: BackgroundTaskConfig);
    getConcurrencyLimit(model: string): number;
    acquire(model: string): Promise<void>;
    release(model: string): void;
    /**
     * Cancel all waiting acquires for a model. Used during cleanup.
     */
    cancelWaiters(model: string): void;
    /**
     * Clear all state. Used during manager cleanup/shutdown.
     * Cancels all pending waiters.
     */
    clear(): void;
    /**
     * Get current count for a model (for testing/debugging)
     */
    getCount(model: string): number;
    /**
     * Get queue length for a model (for testing/debugging)
     */
    getQueueLength(model: string): number;
}
