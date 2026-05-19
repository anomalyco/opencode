type ManagedClientForCleanup = {
    client: {
        stop: () => Promise<void>;
    };
};
type ProcessCleanupOptions = {
    getClients: () => IterableIterator<[string, ManagedClientForCleanup]>;
    clearClients: () => void;
    clearCleanupInterval: () => void;
};
export type LspProcessCleanupHandle = {
    unregister: () => void;
};
export declare function registerLspManagerProcessCleanup(options: ProcessCleanupOptions): LspProcessCleanupHandle;
export {};
