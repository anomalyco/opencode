"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.reversePatch = reversePatch;
function reversePatch(structuredPatch) {
    if (Array.isArray(structuredPatch)) {
        // (See comment in unixToWin for why we need the pointless-looking anonymous function here)
        return structuredPatch.map(function (patch) { return reversePatch(patch); }).reverse();
    }
    return __assign(__assign({}, structuredPatch), { oldFileName: structuredPatch.newFileName, oldHeader: structuredPatch.newHeader, newFileName: structuredPatch.oldFileName, newHeader: structuredPatch.oldHeader, hunks: structuredPatch.hunks.map(function (hunk) {
            return {
                oldLines: hunk.newLines,
                oldStart: hunk.newStart,
                newLines: hunk.oldLines,
                newStart: hunk.oldStart,
                lines: hunk.lines.map(function (l) {
                    if (l.startsWith('-')) {
                        return "+".concat(l.slice(1));
                    }
                    if (l.startsWith('+')) {
                        return "-".concat(l.slice(1));
                    }
                    return l;
                })
            };
        }) });
}
