export declare const DEFAULT_SYNC_POLL_TIMEOUT_MS: number;
export declare function getDefaultSyncPollTimeoutMs(): number;
export declare function getTimingConfig(): {
    POLL_INTERVAL_MS: number;
    MIN_STABILITY_TIME_MS: number;
    STABILITY_POLLS_REQUIRED: number;
    WAIT_FOR_SESSION_INTERVAL_MS: number;
    WAIT_FOR_SESSION_TIMEOUT_MS: number;
    MAX_POLL_TIME_MS: number;
    SESSION_CONTINUATION_STABILITY_MS: number;
};
export declare function __resetTimingConfig(): void;
export declare function __setTimingConfig(overrides: Partial<ReturnType<typeof getTimingConfig>>): void;
