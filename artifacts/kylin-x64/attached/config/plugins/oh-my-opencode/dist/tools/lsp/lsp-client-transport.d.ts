import { type MessageConnection } from "vscode-jsonrpc/node";
import type { Diagnostic, ResolvedServer } from "./types";
import { type UnifiedProcess } from "./lsp-process";
export declare class LSPClientTransport {
    protected root: string;
    protected server: ResolvedServer;
    protected proc: UnifiedProcess | null;
    protected connection: MessageConnection | null;
    protected readonly stderrBuffer: string[];
    protected processExited: boolean;
    protected readonly diagnosticsStore: Map<string, Diagnostic[]>;
    protected readonly REQUEST_TIMEOUT = 15000;
    constructor(root: string, server: ResolvedServer);
    start(): Promise<void>;
    protected startStderrReading(): void;
    protected sendRequest<T>(method: string): Promise<T>;
    protected sendRequest<T>(method: string, params: unknown): Promise<T>;
    protected sendNotification(method: string): void;
    protected sendNotification(method: string, params: unknown): void;
    isAlive(): boolean;
    stop(): Promise<void>;
}
