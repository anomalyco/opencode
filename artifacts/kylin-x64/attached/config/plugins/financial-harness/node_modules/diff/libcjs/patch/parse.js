"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePatch = parsePatch;
/**
 * Parses a patch into structured data, in the same structure returned by `structuredPatch`.
 *
 * @return a JSON object representation of the a patch, suitable for use with the `applyPatch` method.
 */
function parsePatch(uniDiff) {
    var diffstr = uniDiff.split(/\n/), list = [];
    var i = 0;
    function parseIndex() {
        var index = {};
        list.push(index);
        // Parse diff metadata
        while (i < diffstr.length) {
            var line = diffstr[i];
            // File header found, end parsing diff metadata
            if ((/^(---|\+\+\+|@@)\s/).test(line)) {
                break;
            }
            // Diff index
            var header = (/^(?:Index:|diff(?: -r \w+)+)\s+(.+?)\s*$/).exec(line);
            if (header) {
                index.index = header[1];
            }
            i++;
        }
        // Parse file headers if they are defined. Unified diff requires them, but
        // there's no technical issues to have an isolated hunk without file header
        parseFileHeader(index);
        parseFileHeader(index);
        // Parse hunks
        index.hunks = [];
        while (i < diffstr.length) {
            var line = diffstr[i];
            if ((/^(Index:\s|diff\s|---\s|\+\+\+\s|===================================================================)/).test(line)) {
                break;
            }
            else if ((/^@@/).test(line)) {
                index.hunks.push(parseHunk());
            }
            else if (line) {
                throw new Error('Unknown line ' + (i + 1) + ' ' + JSON.stringify(line));
            }
            else {
                i++;
            }
        }
    }
    // Parses the --- and +++ headers, if none are found, no lines
    // are consumed.
    function parseFileHeader(index) {
        var fileHeader = (/^(---|\+\+\+)\s+(.*)\r?$/).exec(diffstr[i]);
        if (fileHeader) {
            var data = fileHeader[2].split('\t', 2), header = (data[1] || '').trim();
            var fileName = data[0].replace(/\\\\/g, '\\');
            if ((/^".*"$/).test(fileName)) {
                fileName = fileName.substr(1, fileName.length - 2);
            }
            if (fileHeader[1] === '---') {
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
        var chunkHeaderIndex = i, chunkHeaderLine = diffstr[i++], chunkHeader = chunkHeaderLine.split(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        var hunk = {
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
        var addCount = 0, removeCount = 0;
        for (; i < diffstr.length && (removeCount < hunk.oldLines || addCount < hunk.newLines || ((_a = diffstr[i]) === null || _a === void 0 ? void 0 : _a.startsWith('\\'))); i++) {
            var operation = (diffstr[i].length == 0 && i != (diffstr.length - 1)) ? ' ' : diffstr[i][0];
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
                throw new Error("Hunk at line ".concat(chunkHeaderIndex + 1, " contained invalid line ").concat(diffstr[i]));
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
        return hunk;
    }
    while (i < diffstr.length) {
        parseIndex();
    }
    return list;
}
