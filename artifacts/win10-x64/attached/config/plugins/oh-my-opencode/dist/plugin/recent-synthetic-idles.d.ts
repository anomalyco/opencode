export declare function pruneRecentSyntheticIdles(args: {
    recentSyntheticIdles: Map<string, number>;
    recentRealIdles: Map<string, number>;
    now: number;
    dedupWindowMs: number;
}): void;
