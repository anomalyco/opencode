/**
 * Executor API SDK
 *
 * Client for the Veritly Executor API which provides isolated execution
 * environments for running bash commands, Python code, and tools.
 */
export interface ExecutorConfig {
    baseUrl: string;
    timeout?: number;
    /** When `baseUrl` targets an in-cluster Ingress VIP, set this to the Ingress rule host (see deploy/k8s `03c-*`). Env: `VERITLY_EXECUTOR_HTTP_HOST`. */
    httpHost?: string;
}
export interface ExecResult {
    output: string;
    exitCode: number;
    sessionId: string;
    mode: "qemu";
    vmId: string;
}
export interface SessionStatus {
    sessionId: string;
    createdAt: number;
    lastActivity: number;
    mode: "qemu";
    vmId: string;
    sshPort?: number;
}
export type ExecutorReadyzStatic = {
    qemuPath: string;
    qemuRunnable: boolean;
    kernelPath: string;
    kernelBytes: number | null;
    initrdPath: string | null;
    initrdBytes: number | null;
    templatePath: string;
    templateBusyboxBytes: number | null;
    templateOk: boolean;
    kvmDevice: boolean;
    platform: string;
    hostArch: string;
};
export type ExecutorReadyzVm = {
    probeId: string;
    vmDir: string;
    sshHost: string;
    sshPort: number;
    msToSsh: number;
    command: string;
    exitCode: number;
    commandOutput: string;
    msExec: number;
    serialTail: string | null;
};
/** Same JSON as `GET /readyz`: static checks plus a real probe VM, SSH, and `echo __readyz_ok__`. */
export interface ExecutorHealth {
    ok: boolean;
    service: "executor";
    mode: "qemu";
    guest: "aarch64" | "x86_64";
    cached: boolean;
    cachedAgeMs?: number;
    qemuVersion?: string;
    activeSessions: number;
    static: ExecutorReadyzStatic;
    vm: ExecutorReadyzVm | null;
    errors: string[];
}
export declare class ExecutorError extends Error {
    readonly code: string;
    readonly statusCode?: number | undefined;
    constructor(message: string, code: string, statusCode?: number | undefined);
}
export declare class ExecutorSDK {
    private baseUrl;
    private defaultTimeout;
    private httpHost?;
    constructor(config: ExecutorConfig);
    private hdr;
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
