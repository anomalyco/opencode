import type { PendingContext, RegisterContextOptions } from "./types";
export declare class ContextCollector {
    private sessions;
    register(sessionID: string, options: RegisterContextOptions): void;
    getPending(sessionID: string): PendingContext;
    consume(sessionID: string): PendingContext;
    clear(sessionID: string): void;
    clearAll(): void;
    hasPending(sessionID: string): boolean;
    private sortEntries;
}
export declare const contextCollector: ContextCollector;
