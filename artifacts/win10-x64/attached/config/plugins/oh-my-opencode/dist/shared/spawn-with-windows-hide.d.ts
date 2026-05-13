export interface SpawnOptions {
    cwd?: string;
    env?: Record<string, string | undefined>;
    stdin?: "pipe" | "inherit" | "ignore";
    stdout?: "pipe" | "inherit" | "ignore";
    stderr?: "pipe" | "inherit" | "ignore";
}
export interface SpawnedProcess {
    readonly exitCode: number | null;
    readonly exited: Promise<number>;
    readonly stdout: ReadableStream<Uint8Array> | undefined;
    readonly stderr: ReadableStream<Uint8Array> | undefined;
    kill(signal?: NodeJS.Signals): void;
}
export declare function spawnWithWindowsHide(command: string[], options: SpawnOptions): SpawnedProcess;
