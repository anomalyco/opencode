export declare function stripLinePrefixes(lines: string[]): string[];
export declare function toNewLines(input: string | string[]): string[];
export declare function restoreLeadingIndent(templateLine: string, line: string): string;
export declare function stripInsertAnchorEcho(anchorLine: string, newLines: string[]): string[];
export declare function stripInsertBeforeEcho(anchorLine: string, newLines: string[]): string[];
export declare function stripInsertBoundaryEcho(afterLine: string, beforeLine: string, newLines: string[]): string[];
export declare function stripRangeBoundaryEcho(lines: string[], startLine: number, endLine: number, newLines: string[]): string[];
