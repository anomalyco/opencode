import { LSPClient } from "./lsp-client";
import type { ResolvedServer } from "./types";
declare class LSPServerManager {
    private static instance;
    private clients;
    private cleanupInterval;
    private readonly IDLE_TIMEOUT;
    private readonly INIT_TIMEOUT;
    private cleanupHandle;
    private constructor();
    private registerProcessCleanup;
    static getInstance(): LSPServerManager;
    private getKey;
    private startCleanupTimer;
    private cleanupIdleClients;
    getClient(root: string, server: ResolvedServer): Promise<LSPClient>;
    warmupClient(root: string, server: ResolvedServer): void;
    releaseClient(root: string, serverId: string): void;
    isServerInitializing(root: string, serverId: string): boolean;
    stopAll(): Promise<void>;
    cleanupTempDirectoryClients(): Promise<void>;
}
export declare const lspManager: LSPServerManager;
export {};
