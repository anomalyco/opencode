import Diff from './base.js';
function isSentenceEndPunct(char) {
    return char == '.' || char == '!' || char == '?';
}
class SentenceDiff extends Diff {
    tokenize(value) {
        var _a;
        // If in future we drop support for environments that don't support lookbehinds, we can replace
        // this entire function with:
        //     return value.split(/(?<=[.!?])(\s+|$)/);
        // but until then, for similar reasons to the trailingWs function in string.ts, we are forced
        // to do this verbosely "by hand" instead of using a regex.
        const result = [];
        let tokenStartI = 0;
        for (let i = 0; i < value.length; i++) {
            if (i == value.length - 1) {
                result.push(value.slice(tokenStartI));
                break;
            }
            if (isSentenceEndPunct(value[i]) && value[i + 1].match(/\s/)) {
                // We've hit a sentence break - i.e. a punctuation mark followed by whitespace.
                // We now want to push TWO tokens to the result:
                // 1. the sentence
                result.push(value.slice(tokenStartI, i + 1));
                // 2. the whitespace
                i = tokenStartI = i + 1;
                while ((_a = value[i + 1]) === null || _a === void 0 ? void 0 : _a.match(/\s/)) {
                    i++;
                }
                result.push(value.slice(tokenStartI, i + 1));
                // Then the next token (a sentence) starts on the character after the whitespace.
                // (It's okay if this is off the end of the string - then the outer loop will terminate
                // here anyway.)
                tokenStartI = i + 1;
            }
        }
        return result;
    }
}
export const sentenceDiff = new SentenceDiff();
export function diffSentences(oldStr, newStr, options) {
    return sentenceDiff.diff(oldStr, newStr, options);
}
