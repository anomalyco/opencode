type JsonFileCacheStoreOptions<TValue> = {
    getCacheDir: () => string;
    filename: string;
    logPrefix: string;
    cacheLabel: string;
    describe: (value: TValue) => Record<string, unknown>;
    serialize?: (value: TValue) => string;
};
type JsonFileCacheStore<TValue> = {
    read: () => TValue | null;
    has: () => boolean;
    write: (value: TValue) => void;
    resetMemory: () => void;
};
export declare function createJsonFileCacheStore<TValue>(options: JsonFileCacheStoreOptions<TValue>): JsonFileCacheStore<TValue>;
export {};
