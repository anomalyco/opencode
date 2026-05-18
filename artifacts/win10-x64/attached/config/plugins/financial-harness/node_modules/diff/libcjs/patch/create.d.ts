import type { StructuredPatch, DiffLinesOptionsAbortable, DiffLinesOptionsNonabortable, AbortableDiffOptions } from '../types.js';
type StructuredPatchCallbackAbortable = (patch: StructuredPatch | undefined) => void;
type StructuredPatchCallbackNonabortable = (patch: StructuredPatch) => void;
interface _StructuredPatchOptionsAbortable extends Pick<DiffLinesOptionsAbortable, 'ignoreWhitespace' | 'stripTrailingCr'> {
    /**
     * describes how many lines of context should be included.
     * You can set this to `Number.MAX_SAFE_INTEGER` or `Infinity` to include the entire file content in one hunk.
     * @default 4
     */
    context?: number;
    callback?: StructuredPatchCallbackAbortable;
}
export type StructuredPatchOptionsAbortable = _StructuredPatchOptionsAbortable & AbortableDiffOptions;
export interface StructuredPatchOptionsNonabortable extends Pick<DiffLinesOptionsNonabortable, 'ignoreWhitespace' | 'stripTrailingCr'> {
    context?: number;
    callback?: StructuredPatchCallbackNonabortable;
}
interface StructuredPatchCallbackOptionAbortable {
    /**
     * If provided, the diff will be computed in async mode to avoid blocking the event loop while the diff is calculated.
     * The value of the `callback` option should be a function and will be passed the computed diff or patch as its first argument.
     */
    callback: StructuredPatchCallbackAbortable;
}
interface StructuredPatchCallbackOptionNonabortable {
    /**
     * If provided, the diff will be computed in async mode to avoid blocking the event loop while the diff is calculated.
     * The value of the `callback` option should be a function and will be passed the computed diff or patch as its first argument.
     */
    callback: StructuredPatchCallbackNonabortable;
}
/**
 * returns an object with an array of hunk objects.
 *
 * This method is similar to createTwoFilesPatch, but returns a data structure suitable for further processing.
 * @param oldFileName String to be output in the filename section of the patch for the removals
 * @param newFileName String to be output in the filename section of the patch for the additions
 * @param oldStr Original string value
 * @param newStr New string value
 * @param oldHeader Optional additional information to include in the old file header.
 * @param newHeader Optional additional information to include in the new file header.
 */
export declare function structuredPatch(oldFileName: string, newFileName: string, oldStr: string, newStr: string, oldHeader: string | undefined, newHeader: string | undefined, options: StructuredPatchCallbackNonabortable): undefined;
export declare function structuredPatch(oldFileName: string, newFileName: string, oldStr: string, newStr: string, oldHeader: string | undefined, newHeader: string | undefined, options: StructuredPatchOptionsAbortable & StructuredPatchCallbackOptionAbortable): undefined;
export declare function structuredPatch(oldFileName: string, newFileName: string, oldStr: string, newStr: string, oldHeader: string | undefined, newHeader: string | undefined, options: StructuredPatchOptionsNonabortable & StructuredPatchCallbackOptionNonabortable): undefined;
export declare function structuredPatch(oldFileName: string, newFileName: string, oldStr: string, newStr: string, oldHeader: string | undefined, newHeader: string | undefined, options: StructuredPatchOptionsAbortable): StructuredPatch | undefined;
export declare function structuredPatch(oldFileName: string, newFileName: string, oldStr: string, newStr: string, oldHeader?: string, newHeader?: string, options?: StructuredPatchOptionsNonabortable): StructuredPatch;
/**
 * creates a unified diff patch.
 * @param patch either a single structured patch object (as returned by `structuredPatch`) or an array of them (as returned by `parsePatch`)
 */
export declare function formatPatch(patch: StructuredPatch | StructuredPatch[]): string;
type CreatePatchCallbackAbortable = (patch: string | undefined) => void;
type CreatePatchCallbackNonabortable = (patch: string) => void;
interface _CreatePatchOptionsAbortable extends Pick<DiffLinesOptionsAbortable, 'ignoreWhitespace' | 'stripTrailingCr'> {
    context?: number;
    callback?: CreatePatchCallbackAbortable;
}
export type CreatePatchOptionsAbortable = _CreatePatchOptionsAbortable & AbortableDiffOptions;
export interface CreatePatchOptionsNonabortable extends Pick<DiffLinesOptionsNonabortable, 'ignoreWhitespace' | 'stripTrailingCr'> {
    context?: number;
    callback?: CreatePatchCallbackNonabortable;
}
interface CreatePatchCallbackOptionAbortable {
    callback: CreatePatchCallbackAbortable;
}
interface CreatePatchCallbackOptionNonabortable {
    callback: CreatePatchCallbackNonabortable;
}
/**
 * creates a unified diff patch by first computing a diff with `diffLines` and then serializing it to unified diff format.
 * @param oldFileName String to be output in the filename section of the patch for the removals
 * @param newFileName String to be output in the filename section of the patch for the additions
 * @param oldStr Original string value
 * @param newStr New string value
 * @param oldHeader Optional additional information to include in the old file header.
 * @param newHeader Optional additional information to include in the new file header.
 */
export declare function createTwoFilesPatch(oldFileName: string, newFileName: string, oldStr: string, newStr: string, oldHeader: string | undefined, newHeader: string | undefined, options: CreatePatchCallbackNonabortable): undefined;
export declare function createTwoFilesPatch(oldFileName: string, newFileName: string, oldStr: string, newStr: string, oldHeader: string | undefined, newHeader: string | undefined, options: CreatePatchOptionsAbortable & CreatePatchCallbackOptionAbortable): undefined;
export declare function createTwoFilesPatch(oldFileName: string, newFileName: string, oldStr: string, newStr: string, oldHeader: string | undefined, newHeader: string | undefined, options: CreatePatchOptionsNonabortable & CreatePatchCallbackOptionNonabortable): undefined;
export declare function createTwoFilesPatch(oldFileName: string, newFileName: string, oldStr: string, newStr: string, oldHeader: string | undefined, newHeader: string | undefined, options: CreatePatchOptionsAbortable): string | undefined;
export declare function createTwoFilesPatch(oldFileName: string, newFileName: string, oldStr: string, newStr: string, oldHeader?: string, newHeader?: string, options?: CreatePatchOptionsNonabortable): string;
/**
 * creates a unified diff patch.
 *
 * Just like createTwoFilesPatch, but with oldFileName being equal to newFileName.
 * @param fileName String to be output in the filename section of the patch
 * @param oldStr Original string value
 * @param newStr New string value
 * @param oldHeader Optional additional information to include in the old file header.
 * @param newHeader Optional additional information to include in the new file header.
 */
export declare function createPatch(fileName: string, oldStr: string, newStr: string, oldHeader: string | undefined, newHeader: string | undefined, options: CreatePatchCallbackNonabortable): undefined;
export declare function createPatch(fileName: string, oldStr: string, newStr: string, oldHeader: string | undefined, newHeader: string | undefined, options: CreatePatchOptionsAbortable & CreatePatchCallbackOptionAbortable): undefined;
export declare function createPatch(fileName: string, oldStr: string, newStr: string, oldHeader: string | undefined, newHeader: string | undefined, options: CreatePatchOptionsNonabortable & CreatePatchCallbackOptionNonabortable): undefined;
export declare function createPatch(fileName: string, oldStr: string, newStr: string, oldHeader: string | undefined, newHeader: string | undefined, options: CreatePatchOptionsAbortable): string | undefined;
export declare function createPatch(fileName: string, oldStr: string, newStr: string, oldHeader?: string, newHeader?: string, options?: CreatePatchOptionsNonabortable): string;
export {};
//# sourceMappingURL=create.d.ts.map