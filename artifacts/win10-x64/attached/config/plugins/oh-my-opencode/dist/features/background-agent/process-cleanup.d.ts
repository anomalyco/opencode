interface CleanupTarget {
    shutdown(): void | Promise<void>;
}
export declare function registerManagerForCleanup(manager: CleanupTarget): void;
export declare function unregisterManagerForCleanup(manager: CleanupTarget): void;
/** @internal - test-only reset for module-level singleton state */
export declare function _resetForTesting(): void;
export {};
