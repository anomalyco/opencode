"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.lineDiff = void 0;
exports.diffLines = diffLines;
exports.diffTrimmedLines = diffTrimmedLines;
exports.tokenize = tokenize;
const base_js_1 = __importDefault(require("./base.js"));
const params_js_1 = require("../util/params.js");
class LineDiff extends base_js_1.default {
    constructor() {
        super(...arguments);
        this.tokenize = tokenize;
    }
    equals(left, right, options) {
        // If we're ignoring whitespace, we need to normalise lines by stripping
        // whitespace before checking equality. (This has an annoying interaction
        // with newlineIsToken that requires special handling: if newlines get their
        // own token, then we DON'T want to trim the *newline* tokens down to empty
        // strings, since this would cause us to treat whitespace-only line content
        // as equal to a separator between lines, which would be weird and
        // inconsistent with the documented behavior of the options.)
        if (options.ignoreWhitespace) {
            if (!options.newlineIsToken || !left.includes('\n')) {
                left = left.trim();
            }
            if (!options.newlineIsToken || !right.includes('\n')) {
                right = right.trim();
            }
        }
        else if (options.ignoreNewlineAtEof && !options.newlineIsToken) {
            if (left.endsWith('\n')) {
                left = left.slice(0, -1);
            }
            if (right.endsWith('\n')) {
                right = right.slice(0, -1);
            }
        }
        return super.equals(left, right, options);
    }
}
exports.lineDiff = new LineDiff();
function diffLines(oldStr, newStr, options) {
    return exports.lineDiff.diff(oldStr, newStr, options);
}
function diffTrimmedLines(oldStr, newStr, options) {
    options = (0, params_js_1.generateOptions)(options, { ignoreWhitespace: true });
    return exports.lineDiff.diff(oldStr, newStr, options);
}
// Exported standalone so it can be used from jsonDiff too.
function tokenize(value, options) {
    if (options.stripTrailingCr) {
        // remove one \r before \n to match GNU diff's --strip-trailing-cr behavior
        value = value.replace(/\r\n/g, '\n');
    }
    const retLines = [], linesAndNewlines = value.split(/(\n|\r\n)/);
    // Ignore the final empty token that occurs if the string ends with a new line
    if (!linesAndNewlines[linesAndNewlines.length - 1]) {
        linesAndNewlines.pop();
    }
    // Merge the content and line separators into single tokens
    for (let i = 0; i < linesAndNewlines.length; i++) {
        const line = linesAndNewlines[i];
        if (i % 2 && !options.newlineIsToken) {
            retLines[retLines.length - 1] += line;
        }
        else {
            retLines.push(line);
        }
    }
    return retLines;
}
