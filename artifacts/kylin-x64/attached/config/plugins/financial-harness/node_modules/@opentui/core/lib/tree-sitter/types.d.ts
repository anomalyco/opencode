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
export interface TreeSitterClientEvents {
    "highlights:response": [bufferId: number, version: number, highlights: HighlightResponse[]];
    "buffer:initialized": [bufferId: number, hasParser: boolean];
    "buffer:disposed": [bufferId: number];
    "worker:log": [logType: "log" | "error", message: string];
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
