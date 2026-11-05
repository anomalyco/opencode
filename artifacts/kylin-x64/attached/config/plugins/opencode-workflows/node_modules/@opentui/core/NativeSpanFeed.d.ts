import { type Pointer } from "./platform/ffi.js";
import type { NativeSpanFeedOptions } from "./zig-structs.js";
export type { GrowthPolicy, NativeSpanFeedOptions, NativeSpanFeedStats } from "./zig-structs.js";
export type DataHandler = (data: Uint8Array) => void | Promise<void>;
/**
 * Zero-copy wrapper over Zig memory; not a full stream interface.
 * Chunk and state typed-array views are borrowed and invalid after destroy.
 */
export declare class NativeSpanFeed {
    static create(options?: NativeSpanFeedOptions): NativeSpanFeed;
    static attach(streamPtr: Pointer, _options?: NativeSpanFeedOptions): NativeSpanFeed;
    readonly streamPtr: Pointer;
    private readonly lib;
    private readonly eventHandler;
    private chunkMap;
    private chunkSizes;
    private dataHandlers;
    private errorHandlers;
    private drainBuffer;
    private stateBuffer;
    private closed;
    private destroyed;
    private draining;
    private pendingDataAvailable;
    private pendingClose;
    private closing;
    private pendingAsyncHandlers;
    private inCallback;
    private closeQueued;
    private idleResolvers;
    private pendingHandlerError;
    private pendingHandlerErrorQueued;
    private constructor();
    private ensureDrainBuffer;
    onData(handler: DataHandler): () => void;
    onError(handler: (code: number) => void): () => void;
    private hasPinnedChunks;
    isBackpressured(): boolean;
    close(): void;
    private processPendingClose;
    private performClose;
    private finalizeDestroy;
    private isIdle;
    private resolveIdleIfNeeded;
    idle(): Promise<void>;
    private handleEvent;
    private decrementRefcount;
    private queuePendingHandlerError;
    private throwPendingHandlerError;
    private drainOnce;
    drainAll(): void;
}
