export declare function createLoopSessionRecovery(options?: {
    recoveryWindowMs?: number;
}): {
    isRecovering(sessionID: string): boolean;
    markRecovering(sessionID: string): void;
    clear(sessionID: string): void;
};
