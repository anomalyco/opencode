export declare function stripTrailingContinuationTokens(text: string): string;
export declare function stripMergeOperatorChars(text: string): string;
export declare function restoreOldWrappedLines(originalLines: string[], replacementLines: string[]): string[];
export declare function maybeExpandSingleLineMerge(originalLines: string[], replacementLines: string[]): string[];
export declare function restoreIndentForPairedReplacement(originalLines: string[], replacementLines: string[]): string[];
export declare function autocorrectReplacementLines(originalLines: string[], replacementLines: string[]): string[];
