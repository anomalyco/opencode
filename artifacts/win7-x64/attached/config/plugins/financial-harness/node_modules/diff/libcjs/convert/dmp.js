"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertChangesToDMP = convertChangesToDMP;
/**
 * converts a list of change objects to the format returned by Google's [diff-match-patch](https://github.com/google/diff-match-patch) library
 */
function convertChangesToDMP(changes) {
    var ret = [];
    var change, operation;
    for (var i = 0; i < changes.length; i++) {
        change = changes[i];
        if (change.added) {
            operation = 1;
        }
        else if (change.removed) {
            operation = -1;
        }
        else {
            operation = 0;
        }
        ret.push([operation, change.value]);
    }
    return ret;
}
