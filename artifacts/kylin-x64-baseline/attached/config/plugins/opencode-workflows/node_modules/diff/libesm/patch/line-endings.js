export function unixToWin(patch) {
    if (Array.isArray(patch)) {
        // It would be cleaner if instead of the line below we could just write
        //     return patch.map(unixToWin)
        // but mysteriously TypeScript (v5.7.3 at the time of writing) does not like this and it will
        // refuse to compile, thinking that unixToWin could then return StructuredPatch[][] and the
        // result would be incompatible with the overload signatures.
        // See bug report at https://github.com/microsoft/TypeScript/issues/61398.
        return patch.map(p => unixToWin(p));
    }
    return Object.assign(Object.assign({}, patch), { hunks: patch.hunks.map(hunk => (Object.assign(Object.assign({}, hunk), { lines: hunk.lines.map((line, i) => {
                var _a;
                return (line.startsWith('\\') || line.endsWith('\r') || ((_a = hunk.lines[i + 1]) === null || _a === void 0 ? void 0 : _a.startsWith('\\')))
                    ? line
                    : line + '\r';
            }) }))) });
}
export function winToUnix(patch) {
    if (Array.isArray(patch)) {
        // (See comment above equivalent line in unixToWin)
        return patch.map(p => winToUnix(p));
    }
    return Object.assign(Object.assign({}, patch), { hunks: patch.hunks.map(hunk => (Object.assign(Object.assign({}, hunk), { lines: hunk.lines.map(line => line.endsWith('\r') ? line.substring(0, line.length - 1) : line) }))) });
}
/**
 * Returns true if the patch consistently uses Unix line endings (or only involves one line and has
 * no line endings).
 */
export function isUnix(patch) {
    if (!Array.isArray(patch)) {
        patch = [patch];
    }
    return !patch.some(index => index.hunks.some(hunk => hunk.lines.some(line => !line.startsWith('\\') && line.endsWith('\r'))));
}
/**
 * Returns true if the patch uses Windows line endings and only Windows line endings.
 */
export function isWin(patch) {
    if (!Array.isArray(patch)) {
        patch = [patch];
    }
    return patch.some(index => index.hunks.some(hunk => hunk.lines.some(line => line.endsWith('\r'))))
        && patch.every(index => index.hunks.every(hunk => hunk.lines.every((line, i) => { var _a; return line.startsWith('\\') || line.endsWith('\r') || ((_a = hunk.lines[i + 1]) === null || _a === void 0 ? void 0 : _a.startsWith('\\')); })));
}
