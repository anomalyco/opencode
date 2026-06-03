import type { SpawnOptions } from "../../shared/spawn-with-windows-hide";
export interface SpawnWithTimeoutResult {
    stdout: string;
    stderr: string;
    exitCode: number;
    timedOut: boolean;
}
export declare function spawnWithTimeout(command: string[], options: SpawnOptions, timeoutMs?: number): Promise<SpawnWithTimeoutResult>;
