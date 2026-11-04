"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePatch = parsePatch;
/**
 * Parses a unified diff format patch into a structured patch object.
 *
 * `parsePatch` has some understanding of Git's particular dialect of unified diff format.
 * When parsing a Git patch, each index in the result may contain additional
 * fields (`isRename`, `isBinary`, etc) not included in the data structure returned by
 * `structuredPatch`; see the `StructuredPatch` interface for a full list.
 *
 * @return a JSON object representation of the patch, suitable for use with the `applyPatch`
 * method. This parses to the same structure returned by `structuredPatch`, except that
 * `oldFileName` and `newFileName` may be `undefined` if the patch doesn't contain enough
 * information to determine them (e.g. a hunk-only patch with no file headers).
 */
function parsePatch(uniDiff) {
    const diffstr = uniDiff.split(/\n/), list = [];
    let i = 0;
    // These helper functions identify line types that can appear between files
    // in a multi-file patch. Keeping them in one place avoids subtle
    // inconsistencies from having the same regexes duplicated in multiple places.
    // Matches `diff --git ...` lines specifically.
    function isGitDiffHeader(line) {
        return (/^diff --git /).test(line);
    }
    // Matches lines that denote the start of a new diff's section in a
    // multi-file patch: `diff --git ...`, `Index: ...`, or `diff -r ...`.
    function isDiffHeader(line) {
        return isGitDiffHeader(line)
            || (/^Index:\s/).test(line)
            || (/^diff(?: -r \w+)+\s/).test(line);
    }
    // Matches `--- ...` and `+++ ...` file header lines.
    function isFileHeader(line) {
        return (/^(---|\+\+\+)\s/).test(line);
    }
    // Matches `@@ ...` hunk header lines.
    function isHunkHeader(line) {
        return (/^@@\s/).test(line);
    }
    function parseIndex() {
        var _a;
        const index = {};
        index.hunks = [];
        list.push(index);
        // Parse diff metadata
        let seenDiffHeader = false;
        while (i < diffstr.length) {
            const line = diffstr[i];
            // File header (---, +++) or hunk header (@@) found; end parsing diff metadata
            if (isFileHeader(line) || isHunkHeader(line)) {
                break;
            }
            // The next two branches handle recognized diff headers. Note that
            // isDiffHeader deliberately does NOT match arbitrary `diff`
            // commands like `diff -u -p -r1.1 -r1.2`, because in some
            // formats (e.g. CVS diffs) such lines appear as metadata within
            // a single file's header section, after an `Index:` line. See the
            // diffx documentation (https://diffx.org) for examples.
            //
            // In both branches: if we've already seen a diff header for *this*
            // file and now we encounter another one, it must belong to the
            // next file, so break.
            if (isGitDiffHeader(line)) {
                if (seenDiffHeader) {
                    return;
                }
                seenDiffHeader = true;
                index.isGit = true;
                // Parse the old and new filenames from the `diff --git` header and
                // tentatively set oldFileName and newFileName from them. These may
                // be overridden below by `rename from` / `rename to` or `copy from` /
                // `copy to` extended headers, or by --- and +++ lines. But for Git
                // diffs that lack all of those (e.g. mode-only changes, binary
                // file changes without rename), these are the only filenames we
                // get.
                // parseGitDiffHeader returns null if the header can't be parsed
                // (e.g. unterminated quoted filename, or unexpected format). In
                // that case we skip setting filenames here; they may still be
                // set from --- / +++ or rename from / rename to lines below.
                const paths = parseGitDiffHeader(line);
                if (paths) {
                    index.oldFileName = paths.oldFileName;
                    index.newFileName = paths.newFileName;
                }
                // Consume Git extended headers (`old mode`, `new mode`, `rename from`,
                // `rename to`, `similarity index`, `index`, `Binary files ... differ`,
                // etc.)
                i++;
                while (i < diffstr.length) {
                    const extLine = diffstr[i];
                    // Stop consuming extended headers if we hit a file header,
                    // hunk header, or another diff header.
                    if (isFileHeader(extLine) || isHunkHeader(extLine) || isDiffHeader(extLine)) {
                        break;
                    }
                    // Parse `rename from` / `rename to` lines - these give us
                    // unambiguous filenames. These lines don't include the
                    // a/ and b/ prefixes that appear in the `diff --git` header
                    // and --- / +++ lines, so we add them for consistency.
                    // Git C-style quotes filenames containing special characters
                    // (tabs, newlines, backslashes, double quotes), so we must
                    // unquote them when present.
                    const renameFromMatch = (/^rename from (.*)/).exec(extLine);
                    if (renameFromMatch) {
                        index.oldFileName = 'a/' + unquoteIfQuoted(renameFromMatch[1]);
                        index.isRename = true;
                    }
                    const renameToMatch = (/^rename to (.*)/).exec(extLine);
                    if (renameToMatch) {
                        index.newFileName = 'b/' + unquoteIfQuoted(renameToMatch[1]);
                        index.isRename = true;
                    }
                    // Parse copy from / copy to lines similarly
                    const copyFromMatch = (/^copy from (.*)/).exec(extLine);
                    if (copyFromMatch) {
                        index.oldFileName = 'a/' + unquoteIfQuoted(copyFromMatch[1]);
                        index.isCopy = true;
                    }
                    const copyToMatch = (/^copy to (.*)/).exec(extLine);
                    if (copyToMatch) {
                        index.newFileName = 'b/' + unquoteIfQuoted(copyToMatch[1]);
                        index.isCopy = true;
                    }
                    const newFileModeMatch = (/^new file mode (\d+)/).exec(extLine);
                    if (newFileModeMatch) {
                        index.isCreate = true;
                        index.newMode = newFileModeMatch[1];
                    }
                    const deletedFileModeMatch = (/^deleted file mode (\d+)/).exec(extLine);
                    if (deletedFileModeMatch) {
                        index.isDelete = true;
                        index.oldMode = deletedFileModeMatch[1];
                    }
                    const oldModeMatch = (/^old mode (\d+)/).exec(extLine);
                    if (oldModeMatch) {
                        index.oldMode = oldModeMatch[1];
                    }
                    const newModeMatch = (/^new mode (\d+)/).exec(extLine);
                    if (newModeMatch) {
                        index.newMode = newModeMatch[1];
                    }
                    if ((/^Binary files /).test(extLine)) {
                        index.isBinary = true;
                    }
                    i++;
                }
                continue;
            }
            else if (isDiffHeader(line)) {
                if (seenDiffHeader) {
                    return;
                }
                seenDiffHeader = true;
                // For Mercurial-style headers like
                //     diff -r 9117c6561b0b -r 273ce12ad8f1 .hgignore
                // or Index: headers like
                //     Index: something with multiple words
                // we extract the trailing filename as the index.
                //
                // TODO: It seems awkward that we indiscriminately trim off
                //       trailing whitespace here. Theoretically, couldn't that
                //       be meaningful - e.g. if the patch represents a diff of a
                //       file whose name ends with a space? Seems wrong to nuke
                //       it. But this behaviour has been around since v2.2.1 in
                //       2015, so if it's going to change, it should be done
                //       cautiously and in a new major release, for
                //       backwards-compat reasons.
                //       -- ExplodingCabbage
                const headerMatch = (/^(?:Index:|diff(?: -r \w+)+)\s+/).exec(line);
                if (headerMatch) {
                    index.index = line.substring(headerMatch[0].length).trim();
                }
            }
            i++;
        }
        // Parse file headers if they are defined. Unified diff requires them, but
        // there's no technical issues to have an isolated hunk without file header
        parseFileHeader(index);
        parseFileHeader(index);
        // If we got one file header but not the other, that's a malformed patch.
        if ((index.oldFileName === undefined) !== (index.newFileName === undefined)) {
            throw new Error('Missing ' + (index.oldFileName !== undefined ? '"+++ ..."' : '"--- ..."')
                + ' file header for ' + ((_a = index.oldFileName) !== null && _a !== void 0 ? _a : index.newFileName));
        }
        while (i < diffstr.length) {
            const line = diffstr[i];
            if (isDiffHeader(line) || isFileHeader(line) || (/^===================================================================/).test(line)) {
                break;
            }
            else if (isHunkHeader(line)) {
                index.hunks.push(parseHunk());
            }
            else {
                // Skip blank lines and any other unrecognized content between
                // or after hunks. Real-world examples of such content include:
                //   - `Only in <dir>: <file>` from GNU `diff -r`
                //   - `Property changes on:` sections from `svn diff`
                //   - Trailing prose or commentary in email patches
                // GNU `patch` tolerates all of these, and so do we.
                i++;
            }
        }
    }
    /**
     * Parses the old and new filenames from a `diff --git` header line.
     *
     * The format is:
     *     diff --git a/<old-path> b/<new-path>
     *
     * When filenames contain special characters (including newlines, tabs,
     * backslashes, or double quotes), Git quotes them with C-style escaping:
     *     diff --git "a/file\twith\ttabs.txt" "b/file\twith\ttabs.txt"
     *
     * When filenames don't contain special characters and the old and new names
     * are the same, we can unambiguously split on ` b/` by finding where the
     * two halves (including their a/ and b/ prefixes) yield matching bare names.
     *
     * A pathological case exists in which we cannot reliably determine the paths
     * from the `diff --git` header. This case is when the following are true:
     * - the old and new file paths differ
     * - they are both unquoted (i.e. contain no special characters)
     * - at least one of the underlying file paths includes the substring ` b/`
     * In this scenario, we do not know which occurrence of ` b/` indicates the
     * start of the new file path, so the header is inherently ambiguous. We thus
     * select a possible interpretation arbitrarily and return that.
     *
     * Fortunately, this ambiguity should never matter, because in any patch
     * genuinely output by Git in which this pathological scenario occurs, there
     * must also be `rename from`/`rename to` or `copy from`/`copy to` extended
     * headers present below the `diff --git` header. `parseIndex` will parse
     * THOSE headers, from which we CAN unambiguously determine the filenames,
     * and will discard the result returned by this function.
     *
     * Returns null if the header can't be parsed at all — e.g. a quoted filename
     * has an unterminated quote, or if the unquoted header doesn't match the
     * expected `a/... b/...` format. In that case, the caller (parseIndex)
     * skips setting oldFileName/newFileName from this header, but they may
     * still be set later from `---`/`+++` lines or `rename from`/`rename to`
     * extended headers; if none of those are present either, they'll remain
     * undefined in the output.
     */
    function parseGitDiffHeader(line) {
        // Strip the "diff --git " prefix
        const rest = line.substring('diff --git '.length);
        // Handle quoted paths: "a/path" "b/path"
        // Git quotes paths when they contain characters like newlines, tabs,
        // backslashes, or double quotes (but notably not spaces).
        if (rest.startsWith('"')) {
            const oldPath = parseQuotedFileName(rest);
            if (oldPath === null) {
                return null;
            }
            const afterOld = rest.substring(oldPath.rawLength + 1); // +1 for space
            let newFileName;
            if (afterOld.startsWith('"')) {
                const newPath = parseQuotedFileName(afterOld);
                if (newPath === null) {
                    return null;
                }
                newFileName = newPath.fileName;
            }
            else {
                newFileName = afterOld;
            }
            return {
                oldFileName: oldPath.fileName,
                newFileName
            };
        }
        // Check if the second path is quoted
        // e.g. diff --git a/simple "b/renamed\nnewline.txt"
        const quoteIdx = rest.indexOf('"');
        if (quoteIdx > 0) {
            const oldFileName = rest.substring(0, quoteIdx - 1);
            const newPath = parseQuotedFileName(rest.substring(quoteIdx));
            if (newPath === null) {
                return null;
            }
            return {
                oldFileName,
                newFileName: newPath.fileName
            };
        }
        // Unquoted paths. Try to find the split point.
        // The format is: a/<old-path> b/<new-path>
        //
        // Note the potential ambiguity caused by the possibility of the file paths
        // themselves containing the substring ` b/`, plus the pathological case
        // described in the comment above.
        //
        // Strategy: find all occurrences of " b/" and split on the middle
        // one. When old and new names are the same (which is the only case where
        // we can't rely on extended headers later in the patch so HAVE to get
        // this right), this will always be the correct split.
        if (rest.startsWith('a/')) {
            const splits = [];
            let idx = 0;
            while (true) {
                idx = rest.indexOf(' b/', idx + 1);
                if (idx === -1) {
                    break;
                }
                splits.push(idx);
            }
            if (splits.length > 0) {
                const mid = splits[Math.floor(splits.length / 2)];
                return {
                    oldFileName: rest.substring(0, mid),
                    newFileName: rest.substring(mid + 1)
                };
            }
        }
        // Fallback: can't parse, return null
        return null;
    }
    /**
     * If `s` starts with a double quote, unquotes it using C-style escape
     * rules (as used by Git). Otherwise returns `s` as-is.
     */
    function unquoteIfQuoted(s) {
        if (s.startsWith('"')) {
            const parsed = parseQuotedFileName(s);
            if (parsed) {
                return parsed.fileName;
            }
        }
        return s;
    }
    /**
     * Parses a C-style quoted filename as used by Git or GNU `diff -u`.
     * Returns the unescaped filename and the raw length consumed (including quotes).
     */
    function parseQuotedFileName(s) {
        if (!s.startsWith('"')) {
            return null;
        }
        let result = '';
        let j = 1; // skip opening quote
        while (j < s.length) {
            if (s[j] === '"') {
                return { fileName: result, rawLength: j + 1 };
            }
            if (s[j] === '\\' && j + 1 < s.length) {
                j++;
                switch (s[j]) {
                    case 'a':
                        result += '\x07';
                        break;
                    case 'b':
                        result += '\b';
                        break;
                    case 'f':
                        result += '\f';
                        break;
                    case 'n':
                        result += '\n';
                        break;
                    case 'r':
                        result += '\r';
                        break;
                    case 't':
                        result += '\t';
                        break;
                    case 'v':
                        result += '\v';
                        break;
                    case '\\':
                        result += '\\';
                        break;
                    case '"':
                        result += '"';
                        break;
                    case '0':
                    case '1':
                    case '2':
                    case '3':
                    case '4':
                    case '5':
                    case '6':
                    case '7': {
                        // C-style octal escapes represent raw bytes. Collect
                        // consecutive octal-escaped bytes and decode as UTF-8.
                        // Validate that we have a full 3-digit octal escape
                        if (j + 2 >= s.length || s[j + 1] < '0' || s[j + 1] > '7' || s[j + 2] < '0' || s[j + 2] > '7') {
                            return null;
                        }
                        const bytes = [parseInt(s.substring(j, j + 3), 8)];
                        j += 3;
                        while (s[j] === '\\' && s[j + 1] >= '0' && s[j + 1] <= '7') {
                            if (j + 3 >= s.length || s[j + 2] < '0' || s[j + 2] > '7' || s[j + 3] < '0' || s[j + 3] > '7') {
                                return null;
                            }
                            bytes.push(parseInt(s.substring(j + 1, j + 4), 8));
                            j += 4;
                        }
                        result += new TextDecoder('utf-8').decode(new Uint8Array(bytes));
                        continue; // j already points at the next character
                    }
                    // Note that in C, there are also three kinds of hex escape sequences:
                    // - \xhh
                    // - \uhhhh
                    // - \Uhhhhhhhh
                    // We do not bother to parse them here because, so far as we know,
                    // they are never emitted by any tools that generate unified diff
                    // format diffs, and so for now jsdiff does not consider them legal.
                    default: return null;
                }
            }
            else {
                result += s[j];
            }
            j++;
        }
        // Unterminated quote
        return null;
    }
    // Parses the --- and +++ headers, if none are found, no lines
    // are consumed.
    function parseFileHeader(index) {
        const fileHeaderMatch = (/^(---|\+\+\+)\s+/).exec(diffstr[i]);
        if (fileHeaderMatch) {
            const prefix = fileHeaderMatch[1], data = diffstr[i].substring(3).trim().split('\t', 2), header = (data[1] || '').trim();
            let fileName = data[0];
            if (fileName.startsWith('"')) {
                fileName = unquoteIfQuoted(fileName);
            }
            else {
                fileName = fileName.replace(/\\\\/g, '\\');
            }
            if (prefix === '---') {
                index.oldFileName = fileName;
                index.oldHeader = header;
            }
            else {
                index.newFileName = fileName;
                index.newHeader = header;
            }
            i++;
        }
    }
    // Parses a hunk
    // This assumes that we are at the start of a hunk.
    function parseHunk() {
        var _a;
        const chunkHeaderIndex = i, chunkHeaderLine = diffstr[i++], chunkHeader = chunkHeaderLine.split(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        const hunk = {
            oldStart: +chunkHeader[1],
            oldLines: typeof chunkHeader[2] === 'undefined' ? 1 : +chunkHeader[2],
            newStart: +chunkHeader[3],
            newLines: typeof chunkHeader[4] === 'undefined' ? 1 : +chunkHeader[4],
            lines: []
        };
        // Unified Diff Format quirk: If the chunk size is 0,
        // the first number is one lower than one would expect.
        // https://www.artima.com/weblogs/viewpost.jsp?thread=164293
        if (hunk.oldLines === 0) {
            hunk.oldStart += 1;
        }
        if (hunk.newLines === 0) {
            hunk.newStart += 1;
        }
        let addCount = 0, removeCount = 0;
        for (; i < diffstr.length && (removeCount < hunk.oldLines || addCount < hunk.newLines || ((_a = diffstr[i]) === null || _a === void 0 ? void 0 : _a.startsWith('\\'))); i++) {
            const operation = (diffstr[i].length == 0 && i != (diffstr.length - 1)) ? ' ' : diffstr[i][0];
            if (operation === '+' || operation === '-' || operation === ' ' || operation === '\\') {
                hunk.lines.push(diffstr[i]);
                if (operation === '+') {
                    addCount++;
                }
                else if (operation === '-') {
                    removeCount++;
                }
                else if (operation === ' ') {
                    addCount++;
                    removeCount++;
                }
            }
            else {
                throw new Error(`Hunk at line ${chunkHeaderIndex + 1} contained invalid line ${diffstr[i]}`);
            }
        }
        // Handle the empty block count case
        if (!addCount && hunk.newLines === 1) {
            hunk.newLines = 0;
        }
        if (!removeCount && hunk.oldLines === 1) {
            hunk.oldLines = 0;
        }
        // Perform sanity checking
        if (addCount !== hunk.newLines) {
            throw new Error('Added line count did not match for hunk at line ' + (chunkHeaderIndex + 1));
        }
        if (removeCount !== hunk.oldLines) {
            throw new Error('Removed line count did not match for hunk at line ' + (chunkHeaderIndex + 1));
        }
        // Check for extra hunk-body-like lines after the declared line counts
        // were exhausted. If the very next line starts with ' ', '+', or '-',
        // the hunk's line counts were probably wrong — unless it's a file
        // header (--- or +++), which legitimately appears immediately after a
        // hunk in multi-file diffs without Index lines.
        if (i < diffstr.length && diffstr[i] && (/^[+ -]/).test(diffstr[i])
            && !isFileHeader(diffstr[i])) {
            throw new Error('Hunk at line ' + (chunkHeaderIndex + 1)
                + ' has more lines than expected (expected '
                + hunk.oldLines + ' old lines and ' + hunk.newLines + ' new lines)');
        }
        return hunk;
    }
    while (i < diffstr.length) {
        parseIndex();
    }
    return list;
}
