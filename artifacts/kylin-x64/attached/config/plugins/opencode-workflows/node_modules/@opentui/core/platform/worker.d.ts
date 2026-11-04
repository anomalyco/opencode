export declare const WORKER_UNAVAILABLE = "OpenTUI tree-sitter workers are not available for this runtime yet.";
export interface WorkerMessageEvent<T = unknown> {
    readonly data: T;
}
export interface WorkerErrorEvent {
    readonly error?: unknown;
    readonly message: string;
}
export type WorkerMessageHandler<T = unknown> = (event: WorkerMessageEvent<T>) => void | Promise<void>;
export type WorkerErrorHandler = (event: WorkerErrorEvent) => void;
export interface PlatformWorkerOptions {
    name?: string;
}
export interface PlatformWorkerHandle {
    onmessage: WorkerMessageHandler | null;
    onerror: WorkerErrorHandler | null;
    postMessage(value: unknown): void;
    terminate(): void | Promise<number>;
    addEventListener(type: "message" | "error", listener: WorkerMessageHandler | WorkerErrorHandler): void;
    removeEventListener(type: "message" | "error", listener: WorkerMessageHandler | WorkerErrorHandler): void;
}
export type PlatformWorkerConstructor = new (specifier: string | URL, options?: PlatformWorkerOptions) => PlatformWorkerHandle;
export declare const Worker: PlatformWorkerConstructor;
export declare const isWorkerRuntime: boolean;
export declare function postWorkerMessage(value: unknown): void;
export declare function setWorkerMessageHandler<T>(handler: WorkerMessageHandler<T>): () => void;
