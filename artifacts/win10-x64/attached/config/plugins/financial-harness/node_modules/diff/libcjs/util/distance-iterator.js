"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = default_1;
// Iterator that traverses in the range of [min, max], stepping
// by distance from a given start position. I.e. for [0, 4], with
// start of 2, this will iterate 2, 3, 1, 4, 0.
function default_1(start, minLine, maxLine) {
    var wantForward = true, backwardExhausted = false, forwardExhausted = false, localOffset = 1;
    return function iterator() {
        if (wantForward && !forwardExhausted) {
            if (backwardExhausted) {
                localOffset++;
            }
            else {
                wantForward = false;
            }
            // Check if trying to fit beyond text length, and if not, check it fits
            // after offset location (or desired location on first iteration)
            if (start + localOffset <= maxLine) {
                return start + localOffset;
            }
            forwardExhausted = true;
        }
        if (!backwardExhausted) {
            if (!forwardExhausted) {
                wantForward = true;
            }
            // Check if trying to fit before text beginning, and if not, check it fits
            // before offset location
            if (minLine <= start - localOffset) {
                return start - localOffset++;
            }
            backwardExhausted = true;
            return iterator();
        }
        // We tried to fit hunk before text beginning and beyond text length, then
        // hunk can't fit on the text. Return undefined
        return undefined;
    };
}
