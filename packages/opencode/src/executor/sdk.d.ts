/**
 * Executor API SDK
 *
 * Client for the Veritly Executor API which provides isolated execution
 * environments for running bash commands, Python code, and tools.
 */
export interface ExecutorConfig {
    baseUrl: string;
    timeout?: number;
}
export interface ExecResult {
    output: string;
    exitCode: number;
    sessionId: string;
    mode: "firecracker" | "dangerous-local";
    vmId: string;
}
export interface SessionStatus {
    sessionId: string;
    createdAt: number;
    lastActivity: number;
    mode: "firecracker" | "dangerous-local";
    vmId: string;
    guestIP?: string;
}
export interface ExecutorHealth {
    ok: boolean;
    service: string;
    mode: "firecracker" | "dangerous-local";
    activeSessions: number;
    ready: boolean;
}
export declare class ExecutorError extends Error {
    readonly code: string;
    readonly statusCode?: number | undefined;
    constructor(message: string, code: string, statusCode?: number | undefined);
}
export declare class ExecutorSDK {
    private baseUrl;
    private defaultTimeout;
    constructor(config: ExecutorConfig);
    /**
     * Check executor health
     */
    health(): Promise<ExecutorHealth>;
    /**
     * Execute a command in a session
     * Creates the session if it doesn't exist
     */
    exec(sessionId: string, command: string, timeout?: number): Promise<ExecResult>;
    /**
     * Get session status
     */
    getSession(sessionId: string): Promise<SessionStatus>;
    /**
     * Close a session
     */
    closeSession(sessionId: string): Promise<void>;
    /**
     * List all active sessions (admin)
     */
    listSessions(): Promise<Array<{
        id: string;
        createdAt: number;
        lastActivity: number;
    }>>;
    /**
     * Check if executor is available
     */
    isAvailable(): Promise<boolean>;
}
export declare const Executor: {
    create(config: ExecutorConfig): ExecutorSDK;
};
