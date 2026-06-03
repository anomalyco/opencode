import Diff from './base.js';
class ArrayDiff extends Diff {
    tokenize(value) {
        return value.slice();
    }
    join(value) {
        return value;
    }
    removeEmpty(value) {
        return value;
    }
}
export const arrayDiff = new ArrayDiff();
export function diffArrays(oldArr, newArr, options) {
    return arrayDiff.diff(oldArr, newArr, options);
}
