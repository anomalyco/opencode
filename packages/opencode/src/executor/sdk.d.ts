/**
 * Executor API SDK
 *
 * Client for the Veritly Executor API (MicroPython sandboxes).
 */
export interface ExecutorConfig {
    baseUrl: string;
    timeout?: number;
    /**
     * Override HTTP `Host` (e.g. when `baseUrl` points at an in-cluster Ingress VIP and rules match this host).
     * Also read from env `VERITLY_EXECUTOR_HTTP_HOST`.
     */
    httpHost?: string;
}
export interface ExecResult {
    output: string;
    exitCode: number;
    sessionId: string;
    mode: "micropython";
}
export interface SessionStatus {
    sessionId: string;
    createdAt: number;
    lastActivity: number;
    mode: "micropython";
}
export type ExecutorReadyzStatic = {
    micropythonBin: string;
    micropythonRunnable: boolean;
    micropythonVersion: string | null;
    libPath: string;
    libReadable: boolean;
    probeExit: number | null;
    probeOutput: string | null;
};
/** Same JSON as `GET /readyz`. */
export interface ExecutorHealth {
    ok: boolean;
    service: "executor";
    mode: "micropython";
    cached: boolean;
    cachedAgeMs?: number;
    activeSessions: number;
    static: ExecutorReadyzStatic;
    errors: string[];
}
export declare class ExecutorError extends Error {
    readonly code: string;
    readonly statusCode?: number;
    constructor(message: string, code: string, statusCode?: number);
}
export declare class ExecutorSDK {
    private baseUrl;
    private defaultTimeout;
    private httpHost?;
    constructor(config: ExecutorConfig);
    /**
     * Deep readiness: same as `GET /readyz`.
     */
    health(): Promise<ExecutorHealth>;
    /**
     * Run MicroPython in a session (created if missing).
     */
    exec(sessionId: string, code: string, timeout?: number, workdir?: string): Promise<ExecResult>;
    getSession(sessionId: string): Promise<SessionStatus>;
    closeSession(sessionId: string): Promise<void>;
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
