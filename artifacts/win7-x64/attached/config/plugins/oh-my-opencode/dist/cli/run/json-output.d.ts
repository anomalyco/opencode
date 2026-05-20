import type { RunResult } from "./types";
export interface JsonOutputManager {
    redirectToStderr: () => void;
    restore: () => void;
    emitResult: (result: RunResult) => void;
}
interface JsonOutputManagerOptions {
    stdout?: NodeJS.WriteStream;
    stderr?: NodeJS.WriteStream;
}
export declare function createJsonOutputManager(options?: JsonOutputManagerOptions): JsonOutputManager;
export {};
