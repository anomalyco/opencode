import { hasOnlyWinLineEndings, hasOnlyUnixLineEndings } from '../util/string.js';
import { isWin, isUnix, unixToWin, winToUnix } from './line-endings.js';
import { parsePatch } from './parse.js';
import distanceIterator from '../util/distance-iterator.js';
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
export function applyPatch(source, patch, options = {}) {
    let patches;
    if (typeof patch === 'string') {
        patches = parsePatch(patch);
    }
    else if (Array.isArray(patch)) {
        patches = patch;
    }
    else {
        patches = [patch];
    }
    if (patches.length > 1) {
        throw new Error('applyPatch only works with a single input.');
    }
    return applyStructuredPatch(source, patches[0], options);
}
function applyStructuredPatch(source, patch, options = {}) {
    if (options.autoConvertLineEndings || options.autoConvertLineEndings == null) {
        if (hasOnlyWinLineEndings(source) && isUnix(patch)) {
            patch = unixToWin(patch);
        }
        else if (hasOnlyUnixLineEndings(source) && isWin(patch)) {
            patch = winToUnix(patch);
        }
    }
    // Apply the diff to the input
    const lines = source.split('\n'), hunks = patch.hunks, compareLine = options.compareLine || ((lineNumber, line, operation, patchContent) => line === patchContent), fuzzFactor = options.fuzzFactor || 0;
    let minLine = 0;
    if (fuzzFactor < 0 || !Number.isInteger(fuzzFactor)) {
        throw new Error('fuzzFactor must be a non-negative integer');
    }
    // Special case for empty patch.
    if (!hunks.length) {
        return source;
    }
    // Before anything else, handle EOFNL insertion/removal. If the patch tells us to make a change
    // to the EOFNL that is redundant/impossible - i.e. to remove a newline that's not there, or add a
    // newline that already exists - then we either return false and fail to apply the patch (if
    // fuzzFactor is 0) or simply ignore the problem and do nothing (if fuzzFactor is >0).
    // If we do need to remove/add a newline at EOF, this will always be in the final hunk:
    let prevLine = '', removeEOFNL = false, addEOFNL = false;
    for (let i = 0; i < hunks[hunks.length - 1].lines.length; i++) {
        const line = hunks[hunks.length - 1].lines[i];
        if (line[0] == '\\') {
            if (prevLine[0] == '+') {
                removeEOFNL = true;
            }
            else if (prevLine[0] == '-') {
                addEOFNL = true;
            }
        }
        prevLine = line;
    }
    if (removeEOFNL) {
        if (addEOFNL) {
            // This means the final line gets changed but doesn't have a trailing newline in either the
            // original or patched version. In that case, we do nothing if fuzzFactor > 0, and if
            // fuzzFactor is 0, we simply validate that the source file has no trailing newline.
            if (!fuzzFactor && lines[lines.length - 1] == '') {
                return false;
            }
        }
        else if (lines[lines.length - 1] == '') {
            lines.pop();
        }
        else if (!fuzzFactor) {
            return false;
        }
    }
    else if (addEOFNL) {
        if (lines[lines.length - 1] != '') {
            lines.push('');
        }
        else if (!fuzzFactor) {
            return false;
        }
    }
    /**
     * Checks if the hunk can be made to fit at the provided location with at most `maxErrors`
     * insertions, substitutions, or deletions, while ensuring also that:
     * - lines deleted in the hunk match exactly, and
     * - wherever an insertion operation or block of insertion operations appears in the hunk, the
     *   immediately preceding and following lines of context match exactly
     *
     * `toPos` should be set such that lines[toPos] is meant to match hunkLines[0].
     *
     * If the hunk can be applied, returns an object with properties `oldLineLastI` and
     * `replacementLines`. Otherwise, returns null.
     */
    function applyHunk(hunkLines, toPos, maxErrors, hunkLinesI = 0, lastContextLineMatched = true, patchedLines = [], patchedLinesLength = 0) {
        let nConsecutiveOldContextLines = 0;
        let nextContextLineMustMatch = false;
        for (; hunkLinesI < hunkLines.length; hunkLinesI++) {
            const hunkLine = hunkLines[hunkLinesI], operation = (hunkLine.length > 0 ? hunkLine[0] : ' '), content = (hunkLine.length > 0 ? hunkLine.substr(1) : hunkLine);
            if (operation === '-') {
                if (compareLine(toPos + 1, lines[toPos], operation, content)) {
                    toPos++;
                    nConsecutiveOldContextLines = 0;
                }
                else {
                    if (!maxErrors || lines[toPos] == null) {
                        return null;
                    }
                    patchedLines[patchedLinesLength] = lines[toPos];
                    return applyHunk(hunkLines, toPos + 1, maxErrors - 1, hunkLinesI, false, patchedLines, patchedLinesLength + 1);
                }
            }
            if (operation === '+') {
                if (!lastContextLineMatched) {
                    return null;
                }
                patchedLines[patchedLinesLength] = content;
                patchedLinesLength++;
                nConsecutiveOldContextLines = 0;
                nextContextLineMustMatch = true;
            }
            if (operation === ' ') {
                nConsecutiveOldContextLines++;
                patchedLines[patchedLinesLength] = lines[toPos];
                if (compareLine(toPos + 1, lines[toPos], operation, content)) {
                    patchedLinesLength++;
                    lastContextLineMatched = true;
                    nextContextLineMustMatch = false;
                    toPos++;
                }
                else {
                    if (nextContextLineMustMatch || !maxErrors) {
                        return null;
                    }
                    // Consider 3 possibilities in sequence:
                    // 1. lines contains a *substitution* not included in the patch context, or
                    // 2. lines contains an *insertion* not included in the patch context, or
                    // 3. lines contains a *deletion* not included in the patch context
                    // The first two options are of course only possible if the line from lines is non-null -
                    // i.e. only option 3 is possible if we've overrun the end of the old file.
                    return (lines[toPos] && (applyHunk(hunkLines, toPos + 1, maxErrors - 1, hunkLinesI + 1, false, patchedLines, patchedLinesLength + 1) || applyHunk(hunkLines, toPos + 1, maxErrors - 1, hunkLinesI, false, patchedLines, patchedLinesLength + 1)) || applyHunk(hunkLines, toPos, maxErrors - 1, hunkLinesI + 1, false, patchedLines, patchedLinesLength));
                }
            }
        }
        // Before returning, trim any unmodified context lines off the end of patchedLines and reduce
        // toPos (and thus oldLineLastI) accordingly. This allows later hunks to be applied to a region
        // that starts in this hunk's trailing context.
        patchedLinesLength -= nConsecutiveOldContextLines;
        toPos -= nConsecutiveOldContextLines;
        patchedLines.length = patchedLinesLength;
        return {
            patchedLines,
            oldLineLastI: toPos - 1
        };
    }
    const resultLines = [];
    // Search best fit offsets for each hunk based on the previous ones
    let prevHunkOffset = 0;
    for (let i = 0; i < hunks.length; i++) {
        const hunk = hunks[i];
        let hunkResult;
        const maxLine = lines.length - hunk.oldLines + fuzzFactor;
        let toPos;
        for (let maxErrors = 0; maxErrors <= fuzzFactor; maxErrors++) {
            toPos = hunk.oldStart + prevHunkOffset - 1;
            const iterator = distanceIterator(toPos, minLine, maxLine);
            for (; toPos !== undefined; toPos = iterator()) {
                hunkResult = applyHunk(hunk.lines, toPos, maxErrors);
                if (hunkResult) {
                    break;
                }
            }
            if (hunkResult) {
                break;
            }
        }
        if (!hunkResult) {
            return false;
        }
        // Copy everything from the end of where we applied the last hunk to the start of this hunk
        for (let i = minLine; i < toPos; i++) {
            resultLines.push(lines[i]);
        }
        // Add the lines produced by applying the hunk:
        for (let i = 0; i < hunkResult.patchedLines.length; i++) {
            const line = hunkResult.patchedLines[i];
            resultLines.push(line);
        }
        // Set lower text limit to end of the current hunk, so next ones don't try
        // to fit over already patched text
        minLine = hunkResult.oldLineLastI + 1;
        // Note the offset between where the patch said the hunk should've applied and where we
        // applied it, so we can adjust future hunks accordingly:
        prevHunkOffset = toPos + 1 - hunk.oldStart;
    }
    // Copy over the rest of the lines from the old text
    for (let i = minLine; i < lines.length; i++) {
        resultLines.push(lines[i]);
    }
    return resultLines.join('\n');
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
export function applyPatches(uniDiff, options) {
    const spDiff = typeof uniDiff === 'string' ? parsePatch(uniDiff) : uniDiff;
    let currentIndex = 0;
    function processIndex() {
        const index = spDiff[currentIndex++];
        if (!index) {
            return options.complete();
        }
        options.loadFile(index, function (err, data) {
            if (err) {
                return options.complete(err);
            }
            const updatedContent = applyPatch(data, index, options);
            options.patched(index, updatedContent, function (err) {
                if (err) {
                    return options.complete(err);
                }
                processIndex();
            });
        });
    }
    processIndex();
}
