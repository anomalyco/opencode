"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OMIT_HEADERS = exports.FILE_HEADERS_ONLY = exports.INCLUDE_HEADERS = void 0;
exports.structuredPatch = structuredPatch;
exports.formatPatch = formatPatch;
exports.createTwoFilesPatch = createTwoFilesPatch;
exports.createPatch = createPatch;
const line_js_1 = require("../diff/line.js");
/**
 * Returns true if the filename contains characters that require C-style
 * quoting (as used by Git and GNU diffutils in diff output).
 */
function needsQuoting(s) {
    for (let i = 0; i < s.length; i++) {
        if (s[i] < '\x20' || s[i] > '\x7e' || s[i] === '"' || s[i] === '\\') {
            return true;
        }
    }
    return false;
}
/**
 * C-style quotes a filename, encoding special characters as escape sequences
 * and non-ASCII bytes as octal escapes. This is the inverse of
 * `parseQuotedFileName` in parse.ts.
 *
 * Non-ASCII bytes are encoded as UTF-8 before being emitted as octal escapes.
 * This matches the behaviour of both Git and GNU diffutils, which always emit
 * UTF-8 octal escapes regardless of the underlying filesystem encoding (e.g.
 * Git for Windows converts from NTFS's UTF-16 to UTF-8 internally).
 *
 * If the filename doesn't need quoting, returns it as-is.
 */
function quoteFileNameIfNeeded(s) {
    if (!needsQuoting(s)) {
        return s;
    }
    let result = '"';
    const bytes = new TextEncoder().encode(s);
    let i = 0;
    while (i < bytes.length) {
        const b = bytes[i];
        // See https://en.wikipedia.org/wiki/Escape_sequences_in_C#Escape_sequences
        if (b === 0x07) {
            result += '\\a';
        }
        else if (b === 0x08) {
            result += '\\b';
        }
        else if (b === 0x09) {
            result += '\\t';
        }
        else if (b === 0x0a) {
            result += '\\n';
        }
        else if (b === 0x0b) {
            result += '\\v';
        }
        else if (b === 0x0c) {
            result += '\\f';
        }
        else if (b === 0x0d) {
            result += '\\r';
        }
        else if (b === 0x22) {
            result += '\\"';
        }
        else if (b === 0x5c) {
            result += '\\\\';
        }
        else if (b >= 0x20 && b <= 0x7e) {
            // Just a printable ASCII character that is neither a double quote nor a
            // backslash; no need to escape it.
            result += String.fromCharCode(b);
        }
        else {
            // Either part of a non-ASCII character or a control character without a
            // special escape sequence; needs escaping as a 3-digit octal escape
            result += '\\' + b.toString(8).padStart(3, '0');
        }
        i++;
    }
    result += '"';
    return result;
}
exports.INCLUDE_HEADERS = {
    includeIndex: true,
    includeUnderline: true,
    includeFileHeaders: true
};
exports.FILE_HEADERS_ONLY = {
    includeIndex: false,
    includeUnderline: false,
    includeFileHeaders: true
};
exports.OMIT_HEADERS = {
    includeIndex: false,
    includeUnderline: false,
    includeFileHeaders: false
};
function structuredPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, options) {
    let optionsObj;
    if (!options) {
        optionsObj = {};
    }
    else if (typeof options === 'function') {
        optionsObj = { callback: options };
    }
    else {
        optionsObj = options;
    }
    if (typeof optionsObj.context === 'undefined') {
        optionsObj.context = 4;
    }
    // We copy this into its own variable to placate TypeScript, which thinks
    // optionsObj.context might be undefined in the callbacks below.
    const context = optionsObj.context;
    // @ts-expect-error (runtime check for something that is correctly a static type error)
    if (optionsObj.newlineIsToken) {
        throw new Error('newlineIsToken may not be used with patch-generation functions, only with diffing functions');
    }
    if (!optionsObj.callback) {
        return diffLinesResultToPatch((0, line_js_1.diffLines)(oldStr, newStr, optionsObj));
    }
    else {
        const { callback } = optionsObj;
        (0, line_js_1.diffLines)(oldStr, newStr, Object.assign(Object.assign({}, optionsObj), { callback: (diff) => {
                const patch = diffLinesResultToPatch(diff);
                // TypeScript is unhappy without the cast because it does not understand that `patch` may
                // be undefined here only if `callback` is StructuredPatchCallbackAbortable:
                callback(patch);
            } }));
    }
    function diffLinesResultToPatch(diff) {
        // STEP 1: Build up the patch with no "\ No newline at end of file" lines and with the arrays
        //         of lines containing trailing newline characters. We'll tidy up later...
        if (!diff) {
            return;
        }
        diff.push({ value: '', lines: [] }); // Append an empty value to make cleanup easier
        function contextLines(lines) {
            return lines.map(function (entry) { return ' ' + entry; });
        }
        const hunks = [];
        let oldRangeStart = 0, newRangeStart = 0, curRange = [], oldLine = 1, newLine = 1;
        for (let i = 0; i < diff.length; i++) {
            const current = diff[i], lines = current.lines || splitLines(current.value);
            current.lines = lines;
            if (current.added || current.removed) {
                // If we have previous context, start with that
                if (!oldRangeStart) {
                    const prev = diff[i - 1];
                    oldRangeStart = oldLine;
                    newRangeStart = newLine;
                    if (prev) {
                        curRange = context > 0 ? contextLines(prev.lines.slice(-context)) : [];
                        oldRangeStart -= curRange.length;
                        newRangeStart -= curRange.length;
                    }
                }
                // Output our changes
                for (const line of lines) {
                    curRange.push((current.added ? '+' : '-') + line);
                }
                // Track the updated file position
                if (current.added) {
                    newLine += lines.length;
                }
                else {
                    oldLine += lines.length;
                }
            }
            else {
                // Identical context lines. Track line changes
                if (oldRangeStart) {
                    // Close out any changes that have been output (or join overlapping)
                    if (lines.length <= context * 2 && i < diff.length - 2) {
                        // Overlapping
                        for (const line of contextLines(lines)) {
                            curRange.push(line);
                        }
                    }
                    else {
                        // end the range and output
                        const contextSize = Math.min(lines.length, context);
                        for (const line of contextLines(lines.slice(0, contextSize))) {
                            curRange.push(line);
                        }
                        const hunk = {
                            oldStart: oldRangeStart,
                            oldLines: (oldLine - oldRangeStart + contextSize),
                            newStart: newRangeStart,
                            newLines: (newLine - newRangeStart + contextSize),
                            lines: curRange
                        };
                        hunks.push(hunk);
                        oldRangeStart = 0;
                        newRangeStart = 0;
                        curRange = [];
                    }
                }
                oldLine += lines.length;
                newLine += lines.length;
            }
        }
        // Step 2: eliminate the trailing `\n` from each line of each hunk, and, where needed, add
        //         "\ No newline at end of file".
        for (const hunk of hunks) {
            for (let i = 0; i < hunk.lines.length; i++) {
                if (hunk.lines[i].endsWith('\n')) {
                    hunk.lines[i] = hunk.lines[i].slice(0, -1);
                }
                else {
                    hunk.lines.splice(i + 1, 0, '\\ No newline at end of file');
                    i++; // Skip the line we just added, then continue iterating
                }
            }
        }
        return {
            oldFileName: oldFileName, newFileName: newFileName,
            oldHeader: oldHeader, newHeader: newHeader,
            hunks: hunks
        };
    }
}
/**
 * creates a unified diff patch.
 *
 * @param patch either a single structured patch object (as returned by `structuredPatch`) or an
 *   array of them (as returned by `parsePatch`).
 * @param headerOptions behaves the same as the `headerOptions` option of `createTwoFilesPatch`.
 *   Ignored for patches where `isGit` is `true`.
 *
 * When a patch has `isGit: true`, `formatPatch` output is changed to more closely match Git's
 * output: it emits a `diff --git` header, emits Git extended headers as appropriate based on
 * properties like `isRename`, `isCreate`, `newMode`, etc, and will omit `---`/`+++` file
 * headers for patches with no hunks (e.g. renames without content changes).
 */
function formatPatch(patch, headerOptions) {
    var _a, _b, _c, _d, _e, _f;
    if (!headerOptions) {
        headerOptions = exports.INCLUDE_HEADERS;
    }
    if (Array.isArray(patch)) {
        if (patch.length > 1 && !headerOptions.includeFileHeaders && !patch.every(p => p.isGit)) {
            throw new Error('Cannot omit file headers on a multi-file patch. '
                + '(The result would be unparseable; how would a tool trying to apply '
                + 'the patch know which changes are to which file?)');
        }
        return patch.map(p => formatPatch(p, headerOptions)).join('\n');
    }
    const ret = [];
    // Git patches have a fixed header format (diff --git, extended headers,
    // and ---/+++ when hunks are present), so headerOptions is ignored.
    if (patch.isGit) {
        headerOptions = exports.INCLUDE_HEADERS;
        // Emit Git-style diff --git header and extended headers.
        // Git never puts /dev/null in the "diff --git" line; for file
        // creations/deletions it uses the real filename on both sides.
        if (!patch.oldFileName) {
            throw new Error('oldFileName must be specified for Git patches');
        }
        if (!patch.newFileName) {
            throw new Error('newFileName must be specified for Git patches');
        }
        let gitOldName = patch.oldFileName;
        let gitNewName = patch.newFileName;
        if (patch.isCreate && gitOldName === '/dev/null') {
            gitOldName = gitNewName.replace(/^b\//, 'a/');
        }
        else if (patch.isDelete && gitNewName === '/dev/null') {
            gitNewName = gitOldName.replace(/^a\//, 'b/');
        }
        ret.push('diff --git ' + quoteFileNameIfNeeded(gitOldName) + ' ' + quoteFileNameIfNeeded(gitNewName));
        if (patch.isDelete) {
            ret.push('deleted file mode ' + ((_a = patch.oldMode) !== null && _a !== void 0 ? _a : '100644'));
        }
        if (patch.isCreate) {
            ret.push('new file mode ' + ((_b = patch.newMode) !== null && _b !== void 0 ? _b : '100644'));
        }
        if (patch.oldMode && patch.newMode && !patch.isDelete && !patch.isCreate) {
            ret.push('old mode ' + patch.oldMode);
            ret.push('new mode ' + patch.newMode);
        }
        if (patch.isRename) {
            ret.push('rename from ' + quoteFileNameIfNeeded(((_c = patch.oldFileName) !== null && _c !== void 0 ? _c : '').replace(/^a\//, '')));
            ret.push('rename to ' + quoteFileNameIfNeeded(((_d = patch.newFileName) !== null && _d !== void 0 ? _d : '').replace(/^b\//, '')));
        }
        if (patch.isCopy) {
            ret.push('copy from ' + quoteFileNameIfNeeded(((_e = patch.oldFileName) !== null && _e !== void 0 ? _e : '').replace(/^a\//, '')));
            ret.push('copy to ' + quoteFileNameIfNeeded(((_f = patch.newFileName) !== null && _f !== void 0 ? _f : '').replace(/^b\//, '')));
        }
    }
    else {
        if (headerOptions.includeIndex && patch.oldFileName == patch.newFileName && patch.oldFileName !== undefined) {
            ret.push('Index: ' + patch.oldFileName);
        }
        if (headerOptions.includeUnderline) {
            ret.push('===================================================================');
        }
    }
    // Emit --- / +++ file headers. For Git patches with no hunks (e.g.
    // pure renames, mode-only changes), Git omits these, so we do too.
    const hasHunks = patch.hunks.length > 0;
    if (headerOptions.includeFileHeaders && patch.oldFileName !== undefined && patch.newFileName !== undefined
        && (!patch.isGit || hasHunks)) {
        ret.push('--- ' + quoteFileNameIfNeeded(patch.oldFileName) + (patch.oldHeader ? '\t' + patch.oldHeader : ''));
        ret.push('+++ ' + quoteFileNameIfNeeded(patch.newFileName) + (patch.newHeader ? '\t' + patch.newHeader : ''));
    }
    for (let i = 0; i < patch.hunks.length; i++) {
        const hunk = patch.hunks[i];
        // Unified Diff Format quirk: If the chunk size is 0,
        // the first number is one lower than one would expect.
        // https://www.artima.com/weblogs/viewpost.jsp?thread=164293
        const oldStart = hunk.oldLines === 0 ? hunk.oldStart - 1 : hunk.oldStart;
        const newStart = hunk.newLines === 0 ? hunk.newStart - 1 : hunk.newStart;
        ret.push('@@ -' + oldStart + ',' + hunk.oldLines
            + ' +' + newStart + ',' + hunk.newLines
            + ' @@');
        for (const line of hunk.lines) {
            ret.push(line);
        }
    }
    return ret.join('\n') + '\n';
}
function createTwoFilesPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, options) {
    if (typeof options === 'function') {
        options = { callback: options };
    }
    if (!(options === null || options === void 0 ? void 0 : options.callback)) {
        const patchObj = structuredPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, options);
        if (!patchObj) {
            return;
        }
        return formatPatch(patchObj, options === null || options === void 0 ? void 0 : options.headerOptions);
    }
    else {
        const { callback } = options;
        structuredPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, Object.assign(Object.assign({}, options), { callback: patchObj => {
                if (!patchObj) {
                    callback(undefined);
                }
                else {
                    callback(formatPatch(patchObj, options.headerOptions));
                }
            } }));
    }
}
function createPatch(fileName, oldStr, newStr, oldHeader, newHeader, options) {
    return createTwoFilesPatch(fileName, fileName, oldStr, newStr, oldHeader, newHeader, options);
}
/**
 * Split `text` into an array of lines, including the trailing newline character (where present)
 */
function splitLines(text) {
    const hasTrailingNl = text.endsWith('\n');
    const result = text.split('\n').map(line => line + '\n');
    if (hasTrailingNl) {
        result.pop();
    }
    else {
        result.push(result.pop().slice(0, -1));
    }
    return result;
}
