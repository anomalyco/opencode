export interface LineRef {
    line: number;
    hash: string;
}
interface HashMismatch {
    line: number;
    expected: string;
}
export declare function normalizeLineRef(ref: string): string;
export declare function parseLineRef(ref: string): LineRef;
export declare function validateLineRef(lines: string[], ref: string): void;
export declare class HashlineMismatchError extends Error {
    private readonly mismatches;
    private readonly fileLines;
    readonly remaps: ReadonlyMap<string, string>;
    constructor(mismatches: HashMismatch[], fileLines: string[]);
    static formatMessage(mismatches: HashMismatch[], fileLines: string[]): string;
}
export declare function validateLineRefs(lines: string[], refs: string[]): void;
export {};
