export function reversePatch(structuredPatch) {
    if (Array.isArray(structuredPatch)) {
        // (See comment in unixToWin for why we need the pointless-looking anonymous function here)
        return structuredPatch.map(patch => reversePatch(patch)).reverse();
    }
    return Object.assign(Object.assign({}, structuredPatch), { oldFileName: structuredPatch.newFileName, oldHeader: structuredPatch.newHeader, newFileName: structuredPatch.oldFileName, newHeader: structuredPatch.oldHeader, hunks: structuredPatch.hunks.map(hunk => {
            return {
                oldLines: hunk.newLines,
                oldStart: hunk.newStart,
                newLines: hunk.oldLines,
                newStart: hunk.oldStart,
                lines: hunk.lines.map(l => {
                    if (l.startsWith('-')) {
                        return `+${l.slice(1)}`;
                    }
                    if (l.startsWith('+')) {
                        return `-${l.slice(1)}`;
                    }
                    return l;
                })
            };
        }) });
}
