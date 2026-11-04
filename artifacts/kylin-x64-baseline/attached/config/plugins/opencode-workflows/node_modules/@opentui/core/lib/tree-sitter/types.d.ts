export interface HighlightRange {
    startCol: number;
    endCol: number;
    group: string;
}
export interface HighlightResponse {
    line: number;
    highlights: HighlightRange[];
    droppedHighlights: HighlightRange[];
}
export interface HighlightMeta {
    isInjection?: boolean;
    injectionLang?: string;
    containsInjection?: boolean;
    conceal?: string | null;
    concealLines?: string | null;
}
export type SimpleHighlight = [number, number, string, HighlightMeta?];
export interface InjectionMapping {
    nodeTypes?: {
        [nodeType: string]: string;
    };
    infoStringMap?: {
        [infoString: string]: string;
    };
}
export interface FiletypeParserOptions {
    filetype: string;
    aliases?: string[];
    queries: {
        highlights: string[];
        injections?: string[];
    };
    wasm: string;
    injectionMapping?: InjectionMapping;
}
export interface BufferState {
    id: number;
    version: number;
    content: string;
    filetype: string;
    hasParser: boolean;
}
export interface ParsedBuffer extends BufferState {
    hasParser: true;
}
export type TreeSitterWorkerLogType = "log" | "error" | "warn";
export type TreeSitterWorkerRequest = {
    type: "INIT";
    dataPath: string;
    treeSitterWasmPath?: string;
} | {
    type: "ADD_FILETYPE_PARSER";
    filetypeParser: FiletypeParserOptions;
} | {
    type: "PRELOAD_PARSER";
    filetype: string;
    messageId: string;
} | {
    type: "INITIALIZE_PARSER";
    bufferId: number;
    version: number;
    content: string;
    filetype: string;
    messageId: string;
} | {
    type: "HANDLE_EDITS";
    bufferId: number;
    version: number;
    content: string;
    edits: Edit[];
} | {
    type: "GET_PERFORMANCE";
    messageId: string;
} | {
    type: "RESET_BUFFER";
    bufferId: number;
    version: number;
    content: string;
    edits: Edit[];
} | {
    type: "DISPOSE_BUFFER";
    bufferId: number;
} | {
    type: "ONESHOT_HIGHLIGHT";
    content: string;
    filetype: string;
    messageId: string;
} | {
    type: "UPDATE_DATA_PATH";
    dataPath: string;
    messageId: string;
} | {
    type: "CLEAR_CACHE";
    messageId: string;
};
export type TreeSitterWorkerResponse = {
    type: "INIT_RESPONSE";
    error?: string;
} | {
    type: "PARSER_INIT_RESPONSE";
    bufferId: number;
    messageId: string;
    hasParser: boolean;
    warning?: string;
    error?: string;
} | {
    type: "HIGHLIGHT_RESPONSE";
    bufferId: number;
    version: number;
    highlights: HighlightResponse[];
} | {
    type: "PRELOAD_PARSER_RESPONSE";
    messageId: string;
    hasParser: boolean;
} | {
    type: "BUFFER_DISPOSED";
    bufferId: number;
} | {
    type: "PERFORMANCE_RESPONSE";
    performance: PerformanceStats;
    messageId: string;
} | {
    type: "ONESHOT_HIGHLIGHT_RESPONSE";
    messageId: string;
    hasParser: boolean;
    highlights?: SimpleHighlight[];
    warning?: string;
    error?: string;
} | {
    type: "UPDATE_DATA_PATH_RESPONSE";
    messageId: string;
    error?: string;
} | {
    type: "CLEAR_CACHE_RESPONSE";
    messageId: string;
    error?: string;
} | {
    type: "WARNING";
    bufferId?: number;
    warning: string;
} | {
    type: "ERROR";
    bufferId?: number;
    error: string;
} | {
    type: "WORKER_LOG";
    logType: TreeSitterWorkerLogType;
    data: unknown[];
};
export interface TreeSitterClientEvents {
    "highlights:response": [bufferId: number, version: number, highlights: HighlightResponse[]];
    "buffer:initialized": [bufferId: number, hasParser: boolean];
    "buffer:disposed": [bufferId: number];
    "worker:log": [logType: TreeSitterWorkerLogType, message: string];
    error: [error: string, bufferId?: number];
    warning: [warning: string, bufferId?: number];
}
export interface TreeSitterClientOptions {
    dataPath: string;
    workerPath?: string | URL;
    initTimeout?: number;
}
export interface Edit {
    startIndex: number;
    oldEndIndex: number;
    newEndIndex: number;
    startPosition: {
        row: number;
        column: number;
    };
    oldEndPosition: {
        row: number;
        column: number;
    };
    newEndPosition: {
        row: number;
        column: number;
    };
}
export interface PerformanceStats {
    averageParseTime: number;
    parseTimes: number[];
    averageQueryTime: number;
    queryTimes: number[];
}
