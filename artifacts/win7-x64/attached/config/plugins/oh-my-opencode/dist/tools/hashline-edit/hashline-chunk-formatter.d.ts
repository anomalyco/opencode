export interface HashlineChunkFormatter {
    push(formattedLine: string): string[];
    flush(): string | undefined;
}
interface HashlineChunkFormatterOptions {
    maxChunkLines: number;
    maxChunkBytes: number;
}
export declare function createHashlineChunkFormatter(options: HashlineChunkFormatterOptions): HashlineChunkFormatter;
export {};
