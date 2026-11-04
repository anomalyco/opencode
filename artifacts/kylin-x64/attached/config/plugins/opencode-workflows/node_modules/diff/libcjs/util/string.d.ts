export declare function longestCommonPrefix(str1: string, str2: string): string;
export declare function longestCommonSuffix(str1: string, str2: string): string;
export declare function replacePrefix(string: string, oldPrefix: string, newPrefix: string): string;
export declare function replaceSuffix(string: string, oldSuffix: string, newSuffix: string): string;
export declare function removePrefix(string: string, oldPrefix: string): string;
export declare function removeSuffix(string: string, oldSuffix: string): string;
export declare function maximumOverlap(string1: string, string2: string): string;
/**
 * Returns true if the string consistently uses Windows line endings.
 */
export declare function hasOnlyWinLineEndings(string: string): boolean;
/**
 * Returns true if the string consistently uses Unix line endings.
 */
export declare function hasOnlyUnixLineEndings(string: string): boolean;
/**
 * Split a string into segments using a word segmenter, merging consecutive
 * segments if they are both whitespace segments. Whitespace segments can
 * appear adjacent to one another for two reasons:
 * - newlines always get their own segment
 * - where a diacritic is attached to a whitespace character in the text, the
 *   segment ends after the diacritic, so e.g. " \u0300 " becomes two segments.
 * This function therefore runs the segmenter's .segment() method and then
 * merges consecutive segments of whitespace into a single part.
 */
export declare function segment(string: string, segmenter: Intl.Segmenter): string[];
export declare function trailingWs(string: string, segmenter?: Intl.Segmenter): string;
export declare function leadingWs(string: string, segmenter?: Intl.Segmenter): string;
export declare function leadingAndTrailingWs(string: string, segmenter?: Intl.Segmenter): [string, string];
//# sourceMappingURL=string.d.ts.map