export interface ProcessedCommandStore {
    has(commandKey: string): boolean;
    add(commandKey: string, ttlMs?: number): void;
    cleanupSession(sessionID: string): void;
    clear(): void;
}
export declare function createProcessedCommandStore(): ProcessedCommandStore;
