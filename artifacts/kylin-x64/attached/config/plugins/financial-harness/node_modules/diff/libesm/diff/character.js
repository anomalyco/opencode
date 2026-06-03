import Diff from './base.js';
class CharacterDiff extends Diff {
}
export const characterDiff = new CharacterDiff();
export function diffChars(oldStr, newStr, options) {
    return characterDiff.diff(oldStr, newStr, options);
}
