type ManagedClientForTempDirectoryCleanup = {
    refCount: number;
    client: {
        stop: () => Promise<void>;
    };
};
export declare function cleanupTempDirectoryLspClients(clients: Map<string, ManagedClientForTempDirectoryCleanup>): Promise<void>;
export {};
