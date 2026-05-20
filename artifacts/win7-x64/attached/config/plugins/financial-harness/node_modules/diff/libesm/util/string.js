export function longestCommonPrefix(str1, str2) {
    let i;
    for (i = 0; i < str1.length && i < str2.length; i++) {
        if (str1[i] != str2[i]) {
            return str1.slice(0, i);
        }
    }
    return str1.slice(0, i);
}
export function longestCommonSuffix(str1, str2) {
    let i;
    // Unlike longestCommonPrefix, we need a special case to handle all scenarios
    // where we return the empty string since str1.slice(-0) will return the
    // entire string.
    if (!str1 || !str2 || str1[str1.length - 1] != str2[str2.length - 1]) {
        return '';
    }
    for (i = 0; i < str1.length && i < str2.length; i++) {
        if (str1[str1.length - (i + 1)] != str2[str2.length - (i + 1)]) {
            return str1.slice(-i);
        }
    }
    return str1.slice(-i);
}
export function replacePrefix(string, oldPrefix, newPrefix) {
    if (string.slice(0, oldPrefix.length) != oldPrefix) {
        throw Error(`string ${JSON.stringify(string)} doesn't start with prefix ${JSON.stringify(oldPrefix)}; this is a bug`);
    }
    return newPrefix + string.slice(oldPrefix.length);
}
export function replaceSuffix(string, oldSuffix, newSuffix) {
    if (!oldSuffix) {
        return string + newSuffix;
    }
    if (string.slice(-oldSuffix.length) != oldSuffix) {
        throw Error(`string ${JSON.stringify(string)} doesn't end with suffix ${JSON.stringify(oldSuffix)}; this is a bug`);
    }
    return string.slice(0, -oldSuffix.length) + newSuffix;
}
export function removePrefix(string, oldPrefix) {
    return replacePrefix(string, oldPrefix, '');
}
export function removeSuffix(string, oldSuffix) {
    return replaceSuffix(string, oldSuffix, '');
}
export function maximumOverlap(string1, string2) {
    return string2.slice(0, overlapCount(string1, string2));
}
// Nicked from https://stackoverflow.com/a/60422853/1709587
function overlapCount(a, b) {
    // Deal with cases where the strings differ in length
    let startA = 0;
    if (a.length > b.length) {
        startA = a.length - b.length;
    }
    let endB = b.length;
    if (a.length < b.length) {
        endB = a.length;
    }
    // Create a back-reference for each index
    //   that should be followed in case of a mismatch.
    //   We only need B to make these references:
    const map = Array(endB);
    let k = 0; // Index that lags behind j
    map[0] = 0;
    for (let j = 1; j < endB; j++) {
        if (b[j] == b[k]) {
            map[j] = map[k]; // skip over the same character (optional optimisation)
        }
        else {
            map[j] = k;
        }
        while (k > 0 && b[j] != b[k]) {
            k = map[k];
        }
        if (b[j] == b[k]) {
            k++;
        }
    }
    // Phase 2: use these references while iterating over A
    k = 0;
    for (let i = startA; i < a.length; i++) {
        while (k > 0 && a[i] != b[k]) {
            k = map[k];
        }
        if (a[i] == b[k]) {
            k++;
        }
    }
    return k;
}
/**
 * Returns true if the string consistently uses Windows line endings.
 */
export function hasOnlyWinLineEndings(string) {
    return string.includes('\r\n') && !string.startsWith('\n') && !string.match(/[^\r]\n/);
}
/**
 * Returns true if the string consistently uses Unix line endings.
 */
export function hasOnlyUnixLineEndings(string) {
    return !string.includes('\r\n') && string.includes('\n');
}
export function trailingWs(string) {
    // Yes, this looks overcomplicated and dumb - why not replace the whole function with
    //     return string match(/\s*$/)[0]
    // you ask? Because:
    // 1. the trap described at https://markamery.com/blog/quadratic-time-regexes/ would mean doing
    //    this would cause this function to take O(n²) time in the worst case (specifically when
    //    there is a massive run of NON-TRAILING whitespace in `string`), and
    // 2. the fix proposed in the same blog post, of using a negative lookbehind, is incompatible
    //    with old Safari versions that we'd like to not break if possible (see
    //    https://github.com/kpdecker/jsdiff/pull/550)
    // It feels absurd to do this with an explicit loop instead of a regex, but I really can't see a
    // better way that doesn't result in broken behaviour.
    let i;
    for (i = string.length - 1; i >= 0; i--) {
        if (!string[i].match(/\s/)) {
            break;
        }
    }
    return string.substring(i + 1);
}
export function leadingWs(string) {
    // Thankfully the annoying considerations described in trailingWs don't apply here:
    const match = string.match(/^\s*/);
    return match ? match[0] : '';
}
