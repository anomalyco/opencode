import { EventEmitter } from "events";
import type { TreeSitterClientOptions, TreeSitterClientEvents, BufferState, FiletypeParserOptions, Edit, PerformanceStats, SimpleHighlight } from "./types.js";
declare global {
    const OTUI_TREE_SITTER_WORKER_PATH: string;
}
export declare function addDefaultParsers(parsers: FiletypeParserOptions[]): void;
export declare class TreeSitterClient extends EventEmitter<TreeSitterClientEvents> {
    private initialized;
    private worker;
    private buffers;
    private initializePromise;
    private initializeResolvers;
    private messageCallbacks;
    private messageIdCounter;
    private editQueues;
    private debouncer;
    private options;
    constructor(options: TreeSitterClientOptions);
    private emitError;
    private emitWarning;
    private startWorker;
    private stopWorker;
    private handleReset;
    initialize(): Promise<void>;
    private registerDefaultParsers;
    private resolvePath;
    addFiletypeParser(filetypeParser: FiletypeParserOptions): void;
    getPerformance(): Promise<PerformanceStats>;
    highlightOnce(content: string, filetype: string): Promise<{
        highlights?: SimpleHighlight[];
        warning?: string;
        error?: string;
    }>;
    private handleWorkerMessage;
    preloadParser(filetype: string): Promise<boolean>;
    createBuffer(id: number, content: string, filetype: string, version?: number, autoInitialize?: boolean): Promise<boolean>;
    updateBuffer(id: number, edits: Edit[], newContent: string, version: number): Promise<void>;
    private processEdit;
    removeBuffer(bufferId: number): Promise<void>;
    destroy(): Promise<void>;
    resetBuffer(bufferId: number, version: number, content: string): Promise<void>;
    getBuffer(bufferId: number): BufferState | undefined;
    getAllBuffers(): BufferState[];
    isInitialized(): boolean;
    setDataPath(dataPath: string): Promise<void>;
    clearCache(): Promise<void>;
}
