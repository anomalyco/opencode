export declare function validateCwd(cwd: string): {
    valid: boolean;
    error?: string;
};
interface StreamReader {
    read(): Promise<{
        done: boolean;
        value: Uint8Array | undefined;
    }>;
}
export interface UnifiedProcess {
    stdin: {
        write(chunk: Uint8Array | string): void;
    };
    stdout: {
        getReader(): StreamReader;
    };
    stderr: {
        getReader(): StreamReader;
    };
    exitCode: number | null;
    exited: Promise<number>;
    kill(signal?: string): void;
}
export declare function spawnProcess(command: string[], options: {
    cwd: string;
    env: Record<string, string | undefined>;
}): UnifiedProcess;
export {};
