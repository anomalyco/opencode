export interface ParsedTokenLimitError {
    currentTokens: number;
    maxTokens: number;
    requestId?: string;
    errorType: string;
    providerID?: string;
    modelID?: string;
    messageIndex?: number;
}
export interface RetryState {
    attempt: number;
    lastAttemptTime: number;
    firstAttemptTime: number;
}
export interface TruncateState {
    truncateAttempt: number;
    lastTruncatedPartId?: string;
}
export interface AutoCompactState {
    pendingCompact: Set<string>;
    errorDataBySession: Map<string, ParsedTokenLimitError>;
    retryStateBySession: Map<string, RetryState>;
    retryTimerBySession: Map<string, ReturnType<typeof setTimeout>>;
    truncateStateBySession: Map<string, TruncateState>;
    emptyContentAttemptBySession: Map<string, number>;
    compactionInProgress: Set<string>;
}
export declare const RETRY_CONFIG: {
    readonly maxAttempts: 2;
    readonly initialDelayMs: 2000;
    readonly backoffFactor: 2;
    readonly maxDelayMs: 30000;
};
export declare const TRUNCATE_CONFIG: {
    readonly maxTruncateAttempts: 20;
    readonly minOutputSizeToTruncate: 500;
    readonly targetTokenRatio: 0.5;
    readonly charsPerToken: 4;
};
