export declare function computeLineHash(lineNumber: number, content: string): string;
export declare function computeLegacyLineHash(lineNumber: number, content: string): string;
export declare function formatHashLine(lineNumber: number, content: string): string;
export declare function formatHashLines(content: string): string;
export interface HashlineStreamOptions {
    startLine?: number;
    maxChunkLines?: number;
    maxChunkBytes?: number;
}
export declare function streamHashLinesFromUtf8(source: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>, options?: HashlineStreamOptions): AsyncGenerator<string>;
export declare function streamHashLinesFromLines(lines: Iterable<string> | AsyncIterable<string>, options?: HashlineStreamOptions): AsyncGenerator<string>;
