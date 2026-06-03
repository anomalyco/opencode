import Diff from './base.js';
class CssDiff extends Diff {
    tokenize(value) {
        return value.split(/([{}:;,]|\s+)/);
    }
}
export const cssDiff = new CssDiff();
export function diffCss(oldStr, newStr, options) {
    return cssDiff.diff(oldStr, newStr, options);
}
