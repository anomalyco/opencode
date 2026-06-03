"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.arrayEqual = arrayEqual;
exports.arrayStartsWith = arrayStartsWith;
function arrayEqual(a, b) {
    if (a.length !== b.length) {
        return false;
    }
    return arrayStartsWith(a, b);
}
function arrayStartsWith(array, start) {
    if (start.length > array.length) {
        return false;
    }
    for (var i = 0; i < start.length; i++) {
        if (start[i] !== array[i]) {
            return false;
        }
    }
    return true;
}
