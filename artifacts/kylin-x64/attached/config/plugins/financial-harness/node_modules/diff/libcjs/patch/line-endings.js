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
exports.unixToWin = unixToWin;
exports.winToUnix = winToUnix;
exports.isUnix = isUnix;
exports.isWin = isWin;
function unixToWin(patch) {
    if (Array.isArray(patch)) {
        // It would be cleaner if instead of the line below we could just write
        //     return patch.map(unixToWin)
        // but mysteriously TypeScript (v5.7.3 at the time of writing) does not like this and it will
        // refuse to compile, thinking that unixToWin could then return StructuredPatch[][] and the
        // result would be incompatible with the overload signatures.
        // See bug report at https://github.com/microsoft/TypeScript/issues/61398.
        return patch.map(function (p) { return unixToWin(p); });
    }
    return __assign(__assign({}, patch), { hunks: patch.hunks.map(function (hunk) { return (__assign(__assign({}, hunk), { lines: hunk.lines.map(function (line, i) {
                var _a;
                return (line.startsWith('\\') || line.endsWith('\r') || ((_a = hunk.lines[i + 1]) === null || _a === void 0 ? void 0 : _a.startsWith('\\')))
                    ? line
                    : line + '\r';
            }) })); }) });
}
function winToUnix(patch) {
    if (Array.isArray(patch)) {
        // (See comment above equivalent line in unixToWin)
        return patch.map(function (p) { return winToUnix(p); });
    }
    return __assign(__assign({}, patch), { hunks: patch.hunks.map(function (hunk) { return (__assign(__assign({}, hunk), { lines: hunk.lines.map(function (line) { return line.endsWith('\r') ? line.substring(0, line.length - 1) : line; }) })); }) });
}
/**
 * Returns true if the patch consistently uses Unix line endings (or only involves one line and has
 * no line endings).
 */
function isUnix(patch) {
    if (!Array.isArray(patch)) {
        patch = [patch];
    }
    return !patch.some(function (index) { return index.hunks.some(function (hunk) { return hunk.lines.some(function (line) { return !line.startsWith('\\') && line.endsWith('\r'); }); }); });
}
/**
 * Returns true if the patch uses Windows line endings and only Windows line endings.
 */
function isWin(patch) {
    if (!Array.isArray(patch)) {
        patch = [patch];
    }
    return patch.some(function (index) { return index.hunks.some(function (hunk) { return hunk.lines.some(function (line) { return line.endsWith('\r'); }); }); })
        && patch.every(function (index) { return index.hunks.every(function (hunk) { return hunk.lines.every(function (line, i) { var _a; return line.startsWith('\\') || line.endsWith('\r') || ((_a = hunk.lines[i + 1]) === null || _a === void 0 ? void 0 : _a.startsWith('\\')); }); }); });
}
