import type { AutoCompactState, RetryState, TruncateState } from "./types";
export declare function getOrCreateRetryState(autoCompactState: AutoCompactState, sessionID: string): RetryState;
export declare function getOrCreateTruncateState(autoCompactState: AutoCompactState, sessionID: string): TruncateState;
export declare function clearSessionState(autoCompactState: AutoCompactState, sessionID: string): void;
export declare function setRetryTimer(autoCompactState: AutoCompactState, sessionID: string, timeout: ReturnType<typeof setTimeout>): void;
export declare function clearRetryTimer(autoCompactState: AutoCompactState, sessionID: string): void;
export declare function getEmptyContentAttempt(autoCompactState: AutoCompactState, sessionID: string): number;
export declare function incrementEmptyContentAttempt(autoCompactState: AutoCompactState, sessionID: string): number;
