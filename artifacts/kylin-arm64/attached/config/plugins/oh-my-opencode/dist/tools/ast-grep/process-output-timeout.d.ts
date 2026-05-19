type SpawnedProcess = {
    stdout: ReadableStream | null;
    stderr: ReadableStream | null;
    exited: Promise<number>;
    kill: () => void;
};
export declare function collectProcessOutputWithTimeout(process: SpawnedProcess, timeoutMs: number): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
}>;
export {};
