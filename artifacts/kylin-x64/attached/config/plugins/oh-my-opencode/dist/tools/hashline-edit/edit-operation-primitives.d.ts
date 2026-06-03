interface EditApplyOptions {
    skipValidation?: boolean;
}
export declare function applySetLine(lines: string[], anchor: string, newText: string | string[], options?: EditApplyOptions): string[];
export declare function applyReplaceLines(lines: string[], startAnchor: string, endAnchor: string, newText: string | string[], options?: EditApplyOptions): string[];
export declare function applyInsertAfter(lines: string[], anchor: string, text: string | string[], options?: EditApplyOptions): string[];
export declare function applyInsertBefore(lines: string[], anchor: string, text: string | string[], options?: EditApplyOptions): string[];
export declare function applyAppend(lines: string[], text: string | string[]): string[];
export declare function applyPrepend(lines: string[], text: string | string[]): string[];
export {};
