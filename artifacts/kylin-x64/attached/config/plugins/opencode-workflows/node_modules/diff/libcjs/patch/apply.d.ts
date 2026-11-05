import type { StructuredPatch } from '../types.js';
export interface ApplyPatchOptions {
    /**
     * Maximum Levenshtein distance (in lines deleted, added, or subtituted) between the context shown in a patch hunk and the lines found in the file.
     * @default 0
     */
    fuzzFactor?: number;
    /**
     * If `true`, and if the file to be patched consistently uses different line endings to the patch (i.e. either the file always uses Unix line endings while the patch uses Windows ones, or vice versa), then `applyPatch` will behave as if the line endings in the patch were the same as those in the source file.
     * (If `false`, the patch will usually fail to apply in such circumstances since lines deleted in the patch won't be considered to match those in the source file.)
     * @default true
     */
    autoConvertLineEndings?: boolean;
    /**
     * Callback used to compare to given lines to determine if they should be considered equal when patching.
     * Defaults to strict equality but may be overridden to provide fuzzier comparison.
     * Should return false if the lines should be rejected.
     */
    compareLine?: (lineNumber: number, line: string, operation: string, patchContent: string) => boolean;
}
/**
 * attempts to apply a unified diff patch.
 *
 * Hunks are applied first to last.
 * `applyPatch` first tries to apply the first hunk at the line number specified in the hunk header, and with all context lines matching exactly.
 * If that fails, it tries scanning backwards and forwards, one line at a time, to find a place to apply the hunk where the context lines match exactly.
 * If that still fails, and `fuzzFactor` is greater than zero, it increments the maximum number of mismatches (missing, extra, or changed context lines) that there can be between the hunk context and a region where we are trying to apply the patch such that the hunk will still be considered to match.
 * Regardless of `fuzzFactor`, lines to be deleted in the hunk *must* be present for a hunk to match, and the context lines *immediately* before and after an insertion must match exactly.
 *
 * Once a hunk is successfully fitted, the process begins again with the next hunk.
 * Regardless of `fuzzFactor`, later hunks must be applied later in the file than earlier hunks.
 *
 * If a hunk cannot be successfully fitted *anywhere* with fewer than `fuzzFactor` mismatches, `applyPatch` fails and returns `false`.
 *
 * If a hunk is successfully fitted but not at the line number specified by the hunk header, all subsequent hunks have their target line number adjusted accordingly.
 * (e.g. if the first hunk is applied 10 lines below where the hunk header said it should fit, `applyPatch` will *start* looking for somewhere to apply the second hunk 10 lines below where its hunk header says it goes.)
 *
 * If the patch was applied successfully, returns a string containing the patched text.
 * If the patch could not be applied (because some hunks in the patch couldn't be fitted to the text in `source`), `applyPatch` returns false.
 *
 * @param patch a string diff or the output from the `parsePatch` or `structuredPatch` methods.
 */
export declare function applyPatch(source: string, patch: string | StructuredPatch | [StructuredPatch], options?: ApplyPatchOptions): string | false;
export interface ApplyPatchesOptions extends ApplyPatchOptions {
    loadFile: (index: StructuredPatch, callback: (err: any, data: string) => void) => void;
    patched: (index: StructuredPatch, content: string | false, callback: (err: any) => void) => void;
    complete: (err?: any) => void;
}
/**
 * applies one or more patches.
 *
 * `patch` may be either an array of structured patch objects, or a string representing a patch in unified diff format (which may patch one or more files).
 *
 * This method will iterate over the contents of the patch and apply to data provided through callbacks. The general flow for each patch index is:
 *
 * - `options.loadFile(index, callback)` is called. The caller should then load the contents of the file and then pass that to the `callback(err, data)` callback. Passing an `err` will terminate further patch execution.
 * - `options.patched(index, content, callback)` is called once the patch has been applied. `content` will be the return value from `applyPatch`. When it's ready, the caller should call `callback(err)` callback. Passing an `err` will terminate further patch execution.
 *
 * Once all patches have been applied or an error occurs, the `options.complete(err)` callback is made.
 */
export declare function applyPatches(uniDiff: string | StructuredPatch[], options: ApplyPatchesOptions): void;
//# sourceMappingURL=apply.d.ts.map