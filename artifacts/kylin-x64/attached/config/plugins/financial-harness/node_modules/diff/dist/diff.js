(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
    typeof define === 'function' && define.amd ? define(['exports'], factory) :
    (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.Diff = {}));
})(this, (function (exports) { 'use strict';

    class Diff {
        diff(oldStr, newStr, 
        // Type below is not accurate/complete - see above for full possibilities - but it compiles
        options = {}) {
            let callback;
            if (typeof options === 'function') {
                callback = options;
                options = {};
            }
            else if ('callback' in options) {
                callback = options.callback;
            }
            // Allow subclasses to massage the input prior to running
            const oldString = this.castInput(oldStr, options);
            const newString = this.castInput(newStr, options);
            const oldTokens = this.removeEmpty(this.tokenize(oldString, options));
            const newTokens = this.removeEmpty(this.tokenize(newString, options));
            return this.diffWithOptionsObj(oldTokens, newTokens, options, callback);
        }
        diffWithOptionsObj(oldTokens, newTokens, options, callback) {
            var _a;
            const done = (value) => {
                value = this.postProcess(value, options);
                if (callback) {
                    setTimeout(function () { callback(value); }, 0);
                    return undefined;
                }
                else {
                    return value;
                }
            };
            const newLen = newTokens.length, oldLen = oldTokens.length;
            let editLength = 1;
            let maxEditLength = newLen + oldLen;
            if (options.maxEditLength != null) {
                maxEditLength = Math.min(maxEditLength, options.maxEditLength);
            }
            const maxExecutionTime = (_a = options.timeout) !== null && _a !== void 0 ? _a : Infinity;
            const abortAfterTimestamp = Date.now() + maxExecutionTime;
            const bestPath = [{ oldPos: -1, lastComponent: undefined }];
            // Seed editLength = 0, i.e. the content starts with the same values
            let newPos = this.extractCommon(bestPath[0], newTokens, oldTokens, 0, options);
            if (bestPath[0].oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
                // Identity per the equality and tokenizer
                return done(this.buildValues(bestPath[0].lastComponent, newTokens, oldTokens));
            }
            // Once we hit the right edge of the edit graph on some diagonal k, we can
            // definitely reach the end of the edit graph in no more than k edits, so
            // there's no point in considering any moves to diagonal k+1 any more (from
            // which we're guaranteed to need at least k+1 more edits).
            // Similarly, once we've reached the bottom of the edit graph, there's no
            // point considering moves to lower diagonals.
            // We record this fact by setting minDiagonalToConsider and
            // maxDiagonalToConsider to some finite value once we've hit the edge of
            // the edit graph.
            // This optimization is not faithful to the original algorithm presented in
            // Myers's paper, which instead pointlessly extends D-paths off the end of
            // the edit graph - see page 7 of Myers's paper which notes this point
            // explicitly and illustrates it with a diagram. This has major performance
            // implications for some common scenarios. For instance, to compute a diff
            // where the new text simply appends d characters on the end of the
            // original text of length n, the true Myers algorithm will take O(n+d^2)
            // time while this optimization needs only O(n+d) time.
            let minDiagonalToConsider = -Infinity, maxDiagonalToConsider = Infinity;
            // Main worker method. checks all permutations of a given edit length for acceptance.
            const execEditLength = () => {
                for (let diagonalPath = Math.max(minDiagonalToConsider, -editLength); diagonalPath <= Math.min(maxDiagonalToConsider, editLength); diagonalPath += 2) {
                    let basePath;
                    const removePath = bestPath[diagonalPath - 1], addPath = bestPath[diagonalPath + 1];
                    if (removePath) {
                        // No one else is going to attempt to use this value, clear it
                        // @ts-expect-error - perf optimisation. This type-violating value will never be read.
                        bestPath[diagonalPath - 1] = undefined;
                    }
                    let canAdd = false;
                    if (addPath) {
                        // what newPos will be after we do an insertion:
                        const addPathNewPos = addPath.oldPos - diagonalPath;
                        canAdd = addPath && 0 <= addPathNewPos && addPathNewPos < newLen;
                    }
                    const canRemove = removePath && removePath.oldPos + 1 < oldLen;
                    if (!canAdd && !canRemove) {
                        // If this path is a terminal then prune
                        // @ts-expect-error - perf optimisation. This type-violating value will never be read.
                        bestPath[diagonalPath] = undefined;
                        continue;
                    }
                    // Select the diagonal that we want to branch from. We select the prior
                    // path whose position in the old string is the farthest from the origin
                    // and does not pass the bounds of the diff graph
                    if (!canRemove || (canAdd && removePath.oldPos < addPath.oldPos)) {
                        basePath = this.addToPath(addPath, true, false, 0, options);
                    }
                    else {
                        basePath = this.addToPath(removePath, false, true, 1, options);
                    }
                    newPos = this.extractCommon(basePath, newTokens, oldTokens, diagonalPath, options);
                    if (basePath.oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
                        // If we have hit the end of both strings, then we are done
                        return done(this.buildValues(basePath.lastComponent, newTokens, oldTokens)) || true;
                    }
                    else {
                        bestPath[diagonalPath] = basePath;
                        if (basePath.oldPos + 1 >= oldLen) {
                            maxDiagonalToConsider = Math.min(maxDiagonalToConsider, diagonalPath - 1);
                        }
                        if (newPos + 1 >= newLen) {
                            minDiagonalToConsider = Math.max(minDiagonalToConsider, diagonalPath + 1);
                        }
                    }
                }
                editLength++;
            };
            // Performs the length of edit iteration. Is a bit fugly as this has to support the
            // sync and async mode which is never fun. Loops over execEditLength until a value
            // is produced, or until the edit length exceeds options.maxEditLength (if given),
            // in which case it will return undefined.
            if (callback) {
                (function exec() {
                    setTimeout(function () {
                        if (editLength > maxEditLength || Date.now() > abortAfterTimestamp) {
                            return callback(undefined);
                        }
                        if (!execEditLength()) {
                            exec();
                        }
                    }, 0);
                }());
            }
            else {
                while (editLength <= maxEditLength && Date.now() <= abortAfterTimestamp) {
                    const ret = execEditLength();
                    if (ret) {
                        return ret;
                    }
                }
            }
        }
        addToPath(path, added, removed, oldPosInc, options) {
            const last = path.lastComponent;
            if (last && !options.oneChangePerToken && last.added === added && last.removed === removed) {
                return {
                    oldPos: path.oldPos + oldPosInc,
                    lastComponent: { count: last.count + 1, added: added, removed: removed, previousComponent: last.previousComponent }
                };
            }
            else {
                return {
                    oldPos: path.oldPos + oldPosInc,
                    lastComponent: { count: 1, added: added, removed: removed, previousComponent: last }
                };
            }
        }
        extractCommon(basePath, newTokens, oldTokens, diagonalPath, options) {
            const newLen = newTokens.length, oldLen = oldTokens.length;
            let oldPos = basePath.oldPos, newPos = oldPos - diagonalPath, commonCount = 0;
            while (newPos + 1 < newLen && oldPos + 1 < oldLen && this.equals(oldTokens[oldPos + 1], newTokens[newPos + 1], options)) {
                newPos++;
                oldPos++;
                commonCount++;
                if (options.oneChangePerToken) {
                    basePath.lastComponent = { count: 1, previousComponent: basePath.lastComponent, added: false, removed: false };
                }
            }
            if (commonCount && !options.oneChangePerToken) {
                basePath.lastComponent = { count: commonCount, previousComponent: basePath.lastComponent, added: false, removed: false };
            }
            basePath.oldPos = oldPos;
            return newPos;
        }
        equals(left, right, options) {
            if (options.comparator) {
                return options.comparator(left, right);
            }
            else {
                return left === right
                    || (!!options.ignoreCase && left.toLowerCase() === right.toLowerCase());
            }
        }
        removeEmpty(array) {
            const ret = [];
            for (let i = 0; i < array.length; i++) {
                if (array[i]) {
                    ret.push(array[i]);
                }
            }
            return ret;
        }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        castInput(value, options) {
            return value;
        }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        tokenize(value, options) {
            return Array.from(value);
        }
        join(chars) {
            // Assumes ValueT is string, which is the case for most subclasses.
            // When it's false, e.g. in diffArrays, this method needs to be overridden (e.g. with a no-op)
            // Yes, the casts are verbose and ugly, because this pattern - of having the base class SORT OF
            // assume tokens and values are strings, but not completely - is weird and janky.
            return chars.join('');
        }
        postProcess(changeObjects, 
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        options) {
            return changeObjects;
        }
        get useLongestToken() {
            return false;
        }
        buildValues(lastComponent, newTokens, oldTokens) {
            // First we convert our linked list of components in reverse order to an
            // array in the right order:
            const components = [];
            let nextComponent;
            while (lastComponent) {
                components.push(lastComponent);
                nextComponent = lastComponent.previousComponent;
                delete lastComponent.previousComponent;
                lastComponent = nextComponent;
            }
            components.reverse();
            const componentLen = components.length;
            let componentPos = 0, newPos = 0, oldPos = 0;
            for (; componentPos < componentLen; componentPos++) {
                const component = components[componentPos];
                if (!component.removed) {
                    if (!component.added && this.useLongestToken) {
                        let value = newTokens.slice(newPos, newPos + component.count);
                        value = value.map(function (value, i) {
                            const oldValue = oldTokens[oldPos + i];
                            return oldValue.length > value.length ? oldValue : value;
                        });
                        component.value = this.join(value);
                    }
                    else {
                        component.value = this.join(newTokens.slice(newPos, newPos + component.count));
                    }
                    newPos += component.count;
                    // Common case
                    if (!component.added) {
                        oldPos += component.count;
                    }
                }
                else {
                    component.value = this.join(oldTokens.slice(oldPos, oldPos + component.count));
                    oldPos += component.count;
                }
            }
            return components;
        }
    }

    class CharacterDiff extends Diff {
    }
    const characterDiff = new CharacterDiff();
    function diffChars(oldStr, newStr, options) {
        return characterDiff.diff(oldStr, newStr, options);
    }

    function longestCommonPrefix(str1, str2) {
        let i;
        for (i = 0; i < str1.length && i < str2.length; i++) {
            if (str1[i] != str2[i]) {
                return str1.slice(0, i);
            }
        }
        return str1.slice(0, i);
    }
    function longestCommonSuffix(str1, str2) {
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
    function replacePrefix(string, oldPrefix, newPrefix) {
        if (string.slice(0, oldPrefix.length) != oldPrefix) {
            throw Error(`string ${JSON.stringify(string)} doesn't start with prefix ${JSON.stringify(oldPrefix)}; this is a bug`);
        }
        return newPrefix + string.slice(oldPrefix.length);
    }
    function replaceSuffix(string, oldSuffix, newSuffix) {
        if (!oldSuffix) {
            return string + newSuffix;
        }
        if (string.slice(-oldSuffix.length) != oldSuffix) {
            throw Error(`string ${JSON.stringify(string)} doesn't end with suffix ${JSON.stringify(oldSuffix)}; this is a bug`);
        }
        return string.slice(0, -oldSuffix.length) + newSuffix;
    }
    function removePrefix(string, oldPrefix) {
        return replacePrefix(string, oldPrefix, '');
    }
    function removeSuffix(string, oldSuffix) {
        return replaceSuffix(string, oldSuffix, '');
    }
    function maximumOverlap(string1, string2) {
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
    function hasOnlyWinLineEndings(string) {
        return string.includes('\r\n') && !string.startsWith('\n') && !string.match(/[^\r]\n/);
    }
    /**
     * Returns true if the string consistently uses Unix line endings.
     */
    function hasOnlyUnixLineEndings(string) {
        return !string.includes('\r\n') && string.includes('\n');
    }
    function trailingWs(string) {
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
    function leadingWs(string) {
        // Thankfully the annoying considerations described in trailingWs don't apply here:
        const match = string.match(/^\s*/);
        return match ? match[0] : '';
    }

    // Based on https://en.wikipedia.org/wiki/Latin_script_in_Unicode
    //
    // Ranges and exceptions:
    // Latin-1 Supplement, 0080–00FF
    //  - U+00D7  × Multiplication sign
    //  - U+00F7  ÷ Division sign
    // Latin Extended-A, 0100–017F
    // Latin Extended-B, 0180–024F
    // IPA Extensions, 0250–02AF
    // Spacing Modifier Letters, 02B0–02FF
    //  - U+02C7  ˇ &#711;  Caron
    //  - U+02D8  ˘ &#728;  Breve
    //  - U+02D9  ˙ &#729;  Dot Above
    //  - U+02DA  ˚ &#730;  Ring Above
    //  - U+02DB  ˛ &#731;  Ogonek
    //  - U+02DC  ˜ &#732;  Small Tilde
    //  - U+02DD  ˝ &#733;  Double Acute Accent
    // Latin Extended Additional, 1E00–1EFF
    const extendedWordChars = 'a-zA-Z0-9_\\u{C0}-\\u{FF}\\u{D8}-\\u{F6}\\u{F8}-\\u{2C6}\\u{2C8}-\\u{2D7}\\u{2DE}-\\u{2FF}\\u{1E00}-\\u{1EFF}';
    // Each token is one of the following:
    // - A punctuation mark plus the surrounding whitespace
    // - A word plus the surrounding whitespace
    // - Pure whitespace (but only in the special case where this the entire text
    //   is just whitespace)
    //
    // We have to include surrounding whitespace in the tokens because the two
    // alternative approaches produce horribly broken results:
    // * If we just discard the whitespace, we can't fully reproduce the original
    //   text from the sequence of tokens and any attempt to render the diff will
    //   get the whitespace wrong.
    // * If we have separate tokens for whitespace, then in a typical text every
    //   second token will be a single space character. But this often results in
    //   the optimal diff between two texts being a perverse one that preserves
    //   the spaces between words but deletes and reinserts actual common words.
    //   See https://github.com/kpdecker/jsdiff/issues/160#issuecomment-1866099640
    //   for an example.
    //
    // Keeping the surrounding whitespace of course has implications for .equals
    // and .join, not just .tokenize.
    // This regex does NOT fully implement the tokenization rules described above.
    // Instead, it gives runs of whitespace their own "token". The tokenize method
    // then handles stitching whitespace tokens onto adjacent word or punctuation
    // tokens.
    const tokenizeIncludingWhitespace = new RegExp(`[${extendedWordChars}]+|\\s+|[^${extendedWordChars}]`, 'ug');
    class WordDiff extends Diff {
        equals(left, right, options) {
            if (options.ignoreCase) {
                left = left.toLowerCase();
                right = right.toLowerCase();
            }
            return left.trim() === right.trim();
        }
        tokenize(value, options = {}) {
            let parts;
            if (options.intlSegmenter) {
                const segmenter = options.intlSegmenter;
                if (segmenter.resolvedOptions().granularity != 'word') {
                    throw new Error('The segmenter passed must have a granularity of "word"');
                }
                parts = Array.from(segmenter.segment(value), segment => segment.segment);
            }
            else {
                parts = value.match(tokenizeIncludingWhitespace) || [];
            }
            const tokens = [];
            let prevPart = null;
            parts.forEach(part => {
                if ((/\s/).test(part)) {
                    if (prevPart == null) {
                        tokens.push(part);
                    }
                    else {
                        tokens.push(tokens.pop() + part);
                    }
                }
                else if (prevPart != null && (/\s/).test(prevPart)) {
                    if (tokens[tokens.length - 1] == prevPart) {
                        tokens.push(tokens.pop() + part);
                    }
                    else {
                        tokens.push(prevPart + part);
                    }
                }
                else {
                    tokens.push(part);
                }
                prevPart = part;
            });
            return tokens;
        }
        join(tokens) {
            // Tokens being joined here will always have appeared consecutively in the
            // same text, so we can simply strip off the leading whitespace from all the
            // tokens except the first (and except any whitespace-only tokens - but such
            // a token will always be the first and only token anyway) and then join them
            // and the whitespace around words and punctuation will end up correct.
            return tokens.map((token, i) => {
                if (i == 0) {
                    return token;
                }
                else {
                    return token.replace((/^\s+/), '');
                }
            }).join('');
        }
        postProcess(changes, options) {
            if (!changes || options.oneChangePerToken) {
                return changes;
            }
            let lastKeep = null;
            // Change objects representing any insertion or deletion since the last
            // "keep" change object. There can be at most one of each.
            let insertion = null;
            let deletion = null;
            changes.forEach(change => {
                if (change.added) {
                    insertion = change;
                }
                else if (change.removed) {
                    deletion = change;
                }
                else {
                    if (insertion || deletion) { // May be false at start of text
                        dedupeWhitespaceInChangeObjects(lastKeep, deletion, insertion, change);
                    }
                    lastKeep = change;
                    insertion = null;
                    deletion = null;
                }
            });
            if (insertion || deletion) {
                dedupeWhitespaceInChangeObjects(lastKeep, deletion, insertion, null);
            }
            return changes;
        }
    }
    const wordDiff = new WordDiff();
    function diffWords(oldStr, newStr, options) {
        // This option has never been documented and never will be (it's clearer to
        // just call `diffWordsWithSpace` directly if you need that behavior), but
        // has existed in jsdiff for a long time, so we retain support for it here
        // for the sake of backwards compatibility.
        if ((options === null || options === void 0 ? void 0 : options.ignoreWhitespace) != null && !options.ignoreWhitespace) {
            return diffWordsWithSpace(oldStr, newStr, options);
        }
        return wordDiff.diff(oldStr, newStr, options);
    }
    function dedupeWhitespaceInChangeObjects(startKeep, deletion, insertion, endKeep) {
        // Before returning, we tidy up the leading and trailing whitespace of the
        // change objects to eliminate cases where trailing whitespace in one object
        // is repeated as leading whitespace in the next.
        // Below are examples of the outcomes we want here to explain the code.
        // I=insert, K=keep, D=delete
        // 1. diffing 'foo bar baz' vs 'foo baz'
        //    Prior to cleanup, we have K:'foo ' D:' bar ' K:' baz'
        //    After cleanup, we want:   K:'foo ' D:'bar ' K:'baz'
        //
        // 2. Diffing 'foo bar baz' vs 'foo qux baz'
        //    Prior to cleanup, we have K:'foo ' D:' bar ' I:' qux ' K:' baz'
        //    After cleanup, we want K:'foo ' D:'bar' I:'qux' K:' baz'
        //
        // 3. Diffing 'foo\nbar baz' vs 'foo baz'
        //    Prior to cleanup, we have K:'foo ' D:'\nbar ' K:' baz'
        //    After cleanup, we want K'foo' D:'\nbar' K:' baz'
        //
        // 4. Diffing 'foo baz' vs 'foo\nbar baz'
        //    Prior to cleanup, we have K:'foo\n' I:'\nbar ' K:' baz'
        //    After cleanup, we ideally want K'foo' I:'\nbar' K:' baz'
        //    but don't actually manage this currently (the pre-cleanup change
        //    objects don't contain enough information to make it possible).
        //
        // 5. Diffing 'foo   bar baz' vs 'foo  baz'
        //    Prior to cleanup, we have K:'foo  ' D:'   bar ' K:'  baz'
        //    After cleanup, we want K:'foo  ' D:' bar ' K:'baz'
        //
        // Our handling is unavoidably imperfect in the case where there's a single
        // indel between keeps and the whitespace has changed. For instance, consider
        // diffing 'foo\tbar\nbaz' vs 'foo baz'. Unless we create an extra change
        // object to represent the insertion of the space character (which isn't even
        // a token), we have no way to avoid losing information about the texts'
        // original whitespace in the result we return. Still, we do our best to
        // output something that will look sensible if we e.g. print it with
        // insertions in green and deletions in red.
        // Between two "keep" change objects (or before the first or after the last
        // change object), we can have either:
        // * A "delete" followed by an "insert"
        // * Just an "insert"
        // * Just a "delete"
        // We handle the three cases separately.
        if (deletion && insertion) {
            const oldWsPrefix = leadingWs(deletion.value);
            const oldWsSuffix = trailingWs(deletion.value);
            const newWsPrefix = leadingWs(insertion.value);
            const newWsSuffix = trailingWs(insertion.value);
            if (startKeep) {
                const commonWsPrefix = longestCommonPrefix(oldWsPrefix, newWsPrefix);
                startKeep.value = replaceSuffix(startKeep.value, newWsPrefix, commonWsPrefix);
                deletion.value = removePrefix(deletion.value, commonWsPrefix);
                insertion.value = removePrefix(insertion.value, commonWsPrefix);
            }
            if (endKeep) {
                const commonWsSuffix = longestCommonSuffix(oldWsSuffix, newWsSuffix);
                endKeep.value = replacePrefix(endKeep.value, newWsSuffix, commonWsSuffix);
                deletion.value = removeSuffix(deletion.value, commonWsSuffix);
                insertion.value = removeSuffix(insertion.value, commonWsSuffix);
            }
        }
        else if (insertion) {
            // The whitespaces all reflect what was in the new text rather than
            // the old, so we essentially have no information about whitespace
            // insertion or deletion. We just want to dedupe the whitespace.
            // We do that by having each change object keep its trailing
            // whitespace and deleting duplicate leading whitespace where
            // present.
            if (startKeep) {
                const ws = leadingWs(insertion.value);
                insertion.value = insertion.value.substring(ws.length);
            }
            if (endKeep) {
                const ws = leadingWs(endKeep.value);
                endKeep.value = endKeep.value.substring(ws.length);
            }
            // otherwise we've got a deletion and no insertion
        }
        else if (startKeep && endKeep) {
            const newWsFull = leadingWs(endKeep.value), delWsStart = leadingWs(deletion.value), delWsEnd = trailingWs(deletion.value);
            // Any whitespace that comes straight after startKeep in both the old and
            // new texts, assign to startKeep and remove from the deletion.
            const newWsStart = longestCommonPrefix(newWsFull, delWsStart);
            deletion.value = removePrefix(deletion.value, newWsStart);
            // Any whitespace that comes straight before endKeep in both the old and
            // new texts, and hasn't already been assigned to startKeep, assign to
            // endKeep and remove from the deletion.
            const newWsEnd = longestCommonSuffix(removePrefix(newWsFull, newWsStart), delWsEnd);
            deletion.value = removeSuffix(deletion.value, newWsEnd);
            endKeep.value = replacePrefix(endKeep.value, newWsFull, newWsEnd);
            // If there's any whitespace from the new text that HASN'T already been
            // assigned, assign it to the start:
            startKeep.value = replaceSuffix(startKeep.value, newWsFull, newWsFull.slice(0, newWsFull.length - newWsEnd.length));
        }
        else if (endKeep) {
            // We are at the start of the text. Preserve all the whitespace on
            // endKeep, and just remove whitespace from the end of deletion to the
            // extent that it overlaps with the start of endKeep.
            const endKeepWsPrefix = leadingWs(endKeep.value);
            const deletionWsSuffix = trailingWs(deletion.value);
            const overlap = maximumOverlap(deletionWsSuffix, endKeepWsPrefix);
            deletion.value = removeSuffix(deletion.value, overlap);
        }
        else if (startKeep) {
            // We are at the END of the text. Preserve all the whitespace on
            // startKeep, and just remove whitespace from the start of deletion to
            // the extent that it overlaps with the end of startKeep.
            const startKeepWsSuffix = trailingWs(startKeep.value);
            const deletionWsPrefix = leadingWs(deletion.value);
            const overlap = maximumOverlap(startKeepWsSuffix, deletionWsPrefix);
            deletion.value = removePrefix(deletion.value, overlap);
        }
    }
    class WordsWithSpaceDiff extends Diff {
        tokenize(value) {
            // Slightly different to the tokenizeIncludingWhitespace regex used above in
            // that this one treats each individual newline as a distinct tokens, rather
            // than merging them into other surrounding whitespace. This was requested
            // in https://github.com/kpdecker/jsdiff/issues/180 &
            //    https://github.com/kpdecker/jsdiff/issues/211
            const regex = new RegExp(`(\\r?\\n)|[${extendedWordChars}]+|[^\\S\\n\\r]+|[^${extendedWordChars}]`, 'ug');
            return value.match(regex) || [];
        }
    }
    const wordsWithSpaceDiff = new WordsWithSpaceDiff();
    function diffWordsWithSpace(oldStr, newStr, options) {
        return wordsWithSpaceDiff.diff(oldStr, newStr, options);
    }

    function generateOptions(options, defaults) {
        if (typeof options === 'function') {
            defaults.callback = options;
        }
        else if (options) {
            for (const name in options) {
                /* istanbul ignore else */
                if (Object.prototype.hasOwnProperty.call(options, name)) {
                    defaults[name] = options[name];
                }
            }
        }
        return defaults;
    }

    class LineDiff extends Diff {
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
    const lineDiff = new LineDiff();
    function diffLines(oldStr, newStr, options) {
        return lineDiff.diff(oldStr, newStr, options);
    }
    function diffTrimmedLines(oldStr, newStr, options) {
        options = generateOptions(options, { ignoreWhitespace: true });
        return lineDiff.diff(oldStr, newStr, options);
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
    const sentenceDiff = new SentenceDiff();
    function diffSentences(oldStr, newStr, options) {
        return sentenceDiff.diff(oldStr, newStr, options);
    }

    class CssDiff extends Diff {
        tokenize(value) {
            return value.split(/([{}:;,]|\s+)/);
        }
    }
    const cssDiff = new CssDiff();
    function diffCss(oldStr, newStr, options) {
        return cssDiff.diff(oldStr, newStr, options);
    }

    class JsonDiff extends Diff {
        constructor() {
            super(...arguments);
            this.tokenize = tokenize;
        }
        get useLongestToken() {
            // Discriminate between two lines of pretty-printed, serialized JSON where one of them has a
            // dangling comma and the other doesn't. Turns out including the dangling comma yields the nicest output:
            return true;
        }
        castInput(value, options) {
            const { undefinedReplacement, stringifyReplacer = (k, v) => typeof v === 'undefined' ? undefinedReplacement : v } = options;
            return typeof value === 'string' ? value : JSON.stringify(canonicalize(value, null, null, stringifyReplacer), null, '  ');
        }
        equals(left, right, options) {
            return super.equals(left.replace(/,([\r\n])/g, '$1'), right.replace(/,([\r\n])/g, '$1'), options);
        }
    }
    const jsonDiff = new JsonDiff();
    function diffJson(oldStr, newStr, options) {
        return jsonDiff.diff(oldStr, newStr, options);
    }
    // This function handles the presence of circular references by bailing out when encountering an
    // object that is already on the "stack" of items being processed. Accepts an optional replacer
    function canonicalize(obj, stack, replacementStack, replacer, key) {
        stack = stack || [];
        replacementStack = replacementStack || [];
        if (replacer) {
            obj = replacer(key === undefined ? '' : key, obj);
        }
        let i;
        for (i = 0; i < stack.length; i += 1) {
            if (stack[i] === obj) {
                return replacementStack[i];
            }
        }
        let canonicalizedObj;
        if ('[object Array]' === Object.prototype.toString.call(obj)) {
            stack.push(obj);
            canonicalizedObj = new Array(obj.length);
            replacementStack.push(canonicalizedObj);
            for (i = 0; i < obj.length; i += 1) {
                canonicalizedObj[i] = canonicalize(obj[i], stack, replacementStack, replacer, String(i));
            }
            stack.pop();
            replacementStack.pop();
            return canonicalizedObj;
        }
        if (obj && obj.toJSON) {
            obj = obj.toJSON();
        }
        if (typeof obj === 'object' && obj !== null) {
            stack.push(obj);
            canonicalizedObj = {};
            replacementStack.push(canonicalizedObj);
            const sortedKeys = [];
            let key;
            for (key in obj) {
                /* istanbul ignore else */
                if (Object.prototype.hasOwnProperty.call(obj, key)) {
                    sortedKeys.push(key);
                }
            }
            sortedKeys.sort();
            for (i = 0; i < sortedKeys.length; i += 1) {
                key = sortedKeys[i];
                canonicalizedObj[key] = canonicalize(obj[key], stack, replacementStack, replacer, key);
            }
            stack.pop();
            replacementStack.pop();
        }
        else {
            canonicalizedObj = obj;
        }
        return canonicalizedObj;
    }

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
    const arrayDiff = new ArrayDiff();
    function diffArrays(oldArr, newArr, options) {
        return arrayDiff.diff(oldArr, newArr, options);
    }

    function unixToWin(patch) {
        if (Array.isArray(patch)) {
            // It would be cleaner if instead of the line below we could just write
            //     return patch.map(unixToWin)
            // but mysteriously TypeScript (v5.7.3 at the time of writing) does not like this and it will
            // refuse to compile, thinking that unixToWin could then return StructuredPatch[][] and the
            // result would be incompatible with the overload signatures.
            // See bug report at https://github.com/microsoft/TypeScript/issues/61398.
            return patch.map(p => unixToWin(p));
        }
        return Object.assign(Object.assign({}, patch), { hunks: patch.hunks.map(hunk => (Object.assign(Object.assign({}, hunk), { lines: hunk.lines.map((line, i) => {
                    var _a;
                    return (line.startsWith('\\') || line.endsWith('\r') || ((_a = hunk.lines[i + 1]) === null || _a === void 0 ? void 0 : _a.startsWith('\\')))
                        ? line
                        : line + '\r';
                }) }))) });
    }
    function winToUnix(patch) {
        if (Array.isArray(patch)) {
            // (See comment above equivalent line in unixToWin)
            return patch.map(p => winToUnix(p));
        }
        return Object.assign(Object.assign({}, patch), { hunks: patch.hunks.map(hunk => (Object.assign(Object.assign({}, hunk), { lines: hunk.lines.map(line => line.endsWith('\r') ? line.substring(0, line.length - 1) : line) }))) });
    }
    /**
     * Returns true if the patch consistently uses Unix line endings (or only involves one line and has
     * no line endings).
     */
    function isUnix(patch) {
        if (!Array.isArray(patch)) {
            patch = [patch];
        }
        return !patch.some(index => index.hunks.some(hunk => hunk.lines.some(line => !line.startsWith('\\') && line.endsWith('\r'))));
    }
    /**
     * Returns true if the patch uses Windows line endings and only Windows line endings.
     */
    function isWin(patch) {
        if (!Array.isArray(patch)) {
            patch = [patch];
        }
        return patch.some(index => index.hunks.some(hunk => hunk.lines.some(line => line.endsWith('\r'))))
            && patch.every(index => index.hunks.every(hunk => hunk.lines.every((line, i) => { var _a; return line.startsWith('\\') || line.endsWith('\r') || ((_a = hunk.lines[i + 1]) === null || _a === void 0 ? void 0 : _a.startsWith('\\')); })));
    }

    /**
     * Parses a patch into structured data, in the same structure returned by `structuredPatch`.
     *
     * @return a JSON object representation of the a patch, suitable for use with the `applyPatch` method.
     */
    function parsePatch(uniDiff) {
        const diffstr = uniDiff.split(/\n/), list = [];
        let i = 0;
        function parseIndex() {
            const index = {};
            list.push(index);
            // Parse diff metadata
            while (i < diffstr.length) {
                const line = diffstr[i];
                // File header found, end parsing diff metadata
                if ((/^(---|\+\+\+|@@)\s/).test(line)) {
                    break;
                }
                // Diff index
                const header = (/^(?:Index:|diff(?: -r \w+)+)\s+(.+?)\s*$/).exec(line);
                if (header) {
                    index.index = header[1];
                }
                i++;
            }
            // Parse file headers if they are defined. Unified diff requires them, but
            // there's no technical issues to have an isolated hunk without file header
            parseFileHeader(index);
            parseFileHeader(index);
            // Parse hunks
            index.hunks = [];
            while (i < diffstr.length) {
                const line = diffstr[i];
                if ((/^(Index:\s|diff\s|---\s|\+\+\+\s|===================================================================)/).test(line)) {
                    break;
                }
                else if ((/^@@/).test(line)) {
                    index.hunks.push(parseHunk());
                }
                else if (line) {
                    throw new Error('Unknown line ' + (i + 1) + ' ' + JSON.stringify(line));
                }
                else {
                    i++;
                }
            }
        }
        // Parses the --- and +++ headers, if none are found, no lines
        // are consumed.
        function parseFileHeader(index) {
            const fileHeader = (/^(---|\+\+\+)\s+(.*)\r?$/).exec(diffstr[i]);
            if (fileHeader) {
                const data = fileHeader[2].split('\t', 2), header = (data[1] || '').trim();
                let fileName = data[0].replace(/\\\\/g, '\\');
                if ((/^".*"$/).test(fileName)) {
                    fileName = fileName.substr(1, fileName.length - 2);
                }
                if (fileHeader[1] === '---') {
                    index.oldFileName = fileName;
                    index.oldHeader = header;
                }
                else {
                    index.newFileName = fileName;
                    index.newHeader = header;
                }
                i++;
            }
        }
        // Parses a hunk
        // This assumes that we are at the start of a hunk.
        function parseHunk() {
            var _a;
            const chunkHeaderIndex = i, chunkHeaderLine = diffstr[i++], chunkHeader = chunkHeaderLine.split(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
            const hunk = {
                oldStart: +chunkHeader[1],
                oldLines: typeof chunkHeader[2] === 'undefined' ? 1 : +chunkHeader[2],
                newStart: +chunkHeader[3],
                newLines: typeof chunkHeader[4] === 'undefined' ? 1 : +chunkHeader[4],
                lines: []
            };
            // Unified Diff Format quirk: If the chunk size is 0,
            // the first number is one lower than one would expect.
            // https://www.artima.com/weblogs/viewpost.jsp?thread=164293
            if (hunk.oldLines === 0) {
                hunk.oldStart += 1;
            }
            if (hunk.newLines === 0) {
                hunk.newStart += 1;
            }
            let addCount = 0, removeCount = 0;
            for (; i < diffstr.length && (removeCount < hunk.oldLines || addCount < hunk.newLines || ((_a = diffstr[i]) === null || _a === void 0 ? void 0 : _a.startsWith('\\'))); i++) {
                const operation = (diffstr[i].length == 0 && i != (diffstr.length - 1)) ? ' ' : diffstr[i][0];
                if (operation === '+' || operation === '-' || operation === ' ' || operation === '\\') {
                    hunk.lines.push(diffstr[i]);
                    if (operation === '+') {
                        addCount++;
                    }
                    else if (operation === '-') {
                        removeCount++;
                    }
                    else if (operation === ' ') {
                        addCount++;
                        removeCount++;
                    }
                }
                else {
                    throw new Error(`Hunk at line ${chunkHeaderIndex + 1} contained invalid line ${diffstr[i]}`);
                }
            }
            // Handle the empty block count case
            if (!addCount && hunk.newLines === 1) {
                hunk.newLines = 0;
            }
            if (!removeCount && hunk.oldLines === 1) {
                hunk.oldLines = 0;
            }
            // Perform sanity checking
            if (addCount !== hunk.newLines) {
                throw new Error('Added line count did not match for hunk at line ' + (chunkHeaderIndex + 1));
            }
            if (removeCount !== hunk.oldLines) {
                throw new Error('Removed line count did not match for hunk at line ' + (chunkHeaderIndex + 1));
            }
            return hunk;
        }
        while (i < diffstr.length) {
            parseIndex();
        }
        return list;
    }

    // Iterator that traverses in the range of [min, max], stepping
    // by distance from a given start position. I.e. for [0, 4], with
    // start of 2, this will iterate 2, 3, 1, 4, 0.
    function distanceIterator (start, minLine, maxLine) {
        let wantForward = true, backwardExhausted = false, forwardExhausted = false, localOffset = 1;
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

    /**
     * attempts to apply a unified diff patch.
     *
     * Hunks are applied first to last.
     * `applyPatch` first tries to apply the first hunk at the line number specified in the hunk header, and with all context lines matching exactly.
     * If that fails, it tries scanning backwards and forwards, one line at a time, to find a place to apply the hunk where the context lines match exactly.
     * If that still fails, and `fuzzFactor` is greater than zero, it increments the maximum number of mismatches (missing, extra, or changed context lines) that there can be between the hunk context and a region where we are trying to apply the patch such that the hunk will still be considered to match.
     * Regardless of `fuzzFactor`, lines to be deleted in the hunk *must* be present for a hunk to match, and the context lines *immediately* before and after an insertion must match exactly.
     *
     * Once a hunk is successfully fitted, the process begins again with the next hunk.
     * Regardless of `fuzzFactor`, later hunks must be applied later in the file than earlier hunks.
     *
     * If a hunk cannot be successfully fitted *anywhere* with fewer than `fuzzFactor` mismatches, `applyPatch` fails and returns `false`.
     *
     * If a hunk is successfully fitted but not at the line number specified by the hunk header, all subsequent hunks have their target line number adjusted accordingly.
     * (e.g. if the first hunk is applied 10 lines below where the hunk header said it should fit, `applyPatch` will *start* looking for somewhere to apply the second hunk 10 lines below where its hunk header says it goes.)
     *
     * If the patch was applied successfully, returns a string containing the patched text.
     * If the patch could not be applied (because some hunks in the patch couldn't be fitted to the text in `source`), `applyPatch` returns false.
     *
     * @param patch a string diff or the output from the `parsePatch` or `structuredPatch` methods.
     */
    function applyPatch(source, patch, options = {}) {
        let patches;
        if (typeof patch === 'string') {
            patches = parsePatch(patch);
        }
        else if (Array.isArray(patch)) {
            patches = patch;
        }
        else {
            patches = [patch];
        }
        if (patches.length > 1) {
            throw new Error('applyPatch only works with a single input.');
        }
        return applyStructuredPatch(source, patches[0], options);
    }
    function applyStructuredPatch(source, patch, options = {}) {
        if (options.autoConvertLineEndings || options.autoConvertLineEndings == null) {
            if (hasOnlyWinLineEndings(source) && isUnix(patch)) {
                patch = unixToWin(patch);
            }
            else if (hasOnlyUnixLineEndings(source) && isWin(patch)) {
                patch = winToUnix(patch);
            }
        }
        // Apply the diff to the input
        const lines = source.split('\n'), hunks = patch.hunks, compareLine = options.compareLine || ((lineNumber, line, operation, patchContent) => line === patchContent), fuzzFactor = options.fuzzFactor || 0;
        let minLine = 0;
        if (fuzzFactor < 0 || !Number.isInteger(fuzzFactor)) {
            throw new Error('fuzzFactor must be a non-negative integer');
        }
        // Special case for empty patch.
        if (!hunks.length) {
            return source;
        }
        // Before anything else, handle EOFNL insertion/removal. If the patch tells us to make a change
        // to the EOFNL that is redundant/impossible - i.e. to remove a newline that's not there, or add a
        // newline that already exists - then we either return false and fail to apply the patch (if
        // fuzzFactor is 0) or simply ignore the problem and do nothing (if fuzzFactor is >0).
        // If we do need to remove/add a newline at EOF, this will always be in the final hunk:
        let prevLine = '', removeEOFNL = false, addEOFNL = false;
        for (let i = 0; i < hunks[hunks.length - 1].lines.length; i++) {
            const line = hunks[hunks.length - 1].lines[i];
            if (line[0] == '\\') {
                if (prevLine[0] == '+') {
                    removeEOFNL = true;
                }
                else if (prevLine[0] == '-') {
                    addEOFNL = true;
                }
            }
            prevLine = line;
        }
        if (removeEOFNL) {
            if (addEOFNL) {
                // This means the final line gets changed but doesn't have a trailing newline in either the
                // original or patched version. In that case, we do nothing if fuzzFactor > 0, and if
                // fuzzFactor is 0, we simply validate that the source file has no trailing newline.
                if (!fuzzFactor && lines[lines.length - 1] == '') {
                    return false;
                }
            }
            else if (lines[lines.length - 1] == '') {
                lines.pop();
            }
            else if (!fuzzFactor) {
                return false;
            }
        }
        else if (addEOFNL) {
            if (lines[lines.length - 1] != '') {
                lines.push('');
            }
            else if (!fuzzFactor) {
                return false;
            }
        }
        /**
         * Checks if the hunk can be made to fit at the provided location with at most `maxErrors`
         * insertions, substitutions, or deletions, while ensuring also that:
         * - lines deleted in the hunk match exactly, and
         * - wherever an insertion operation or block of insertion operations appears in the hunk, the
         *   immediately preceding and following lines of context match exactly
         *
         * `toPos` should be set such that lines[toPos] is meant to match hunkLines[0].
         *
         * If the hunk can be applied, returns an object with properties `oldLineLastI` and
         * `replacementLines`. Otherwise, returns null.
         */
        function applyHunk(hunkLines, toPos, maxErrors, hunkLinesI = 0, lastContextLineMatched = true, patchedLines = [], patchedLinesLength = 0) {
            let nConsecutiveOldContextLines = 0;
            let nextContextLineMustMatch = false;
            for (; hunkLinesI < hunkLines.length; hunkLinesI++) {
                const hunkLine = hunkLines[hunkLinesI], operation = (hunkLine.length > 0 ? hunkLine[0] : ' '), content = (hunkLine.length > 0 ? hunkLine.substr(1) : hunkLine);
                if (operation === '-') {
                    if (compareLine(toPos + 1, lines[toPos], operation, content)) {
                        toPos++;
                        nConsecutiveOldContextLines = 0;
                    }
                    else {
                        if (!maxErrors || lines[toPos] == null) {
                            return null;
                        }
                        patchedLines[patchedLinesLength] = lines[toPos];
                        return applyHunk(hunkLines, toPos + 1, maxErrors - 1, hunkLinesI, false, patchedLines, patchedLinesLength + 1);
                    }
                }
                if (operation === '+') {
                    if (!lastContextLineMatched) {
                        return null;
                    }
                    patchedLines[patchedLinesLength] = content;
                    patchedLinesLength++;
                    nConsecutiveOldContextLines = 0;
                    nextContextLineMustMatch = true;
                }
                if (operation === ' ') {
                    nConsecutiveOldContextLines++;
                    patchedLines[patchedLinesLength] = lines[toPos];
                    if (compareLine(toPos + 1, lines[toPos], operation, content)) {
                        patchedLinesLength++;
                        lastContextLineMatched = true;
                        nextContextLineMustMatch = false;
                        toPos++;
                    }
                    else {
                        if (nextContextLineMustMatch || !maxErrors) {
                            return null;
                        }
                        // Consider 3 possibilities in sequence:
                        // 1. lines contains a *substitution* not included in the patch context, or
                        // 2. lines contains an *insertion* not included in the patch context, or
                        // 3. lines contains a *deletion* not included in the patch context
                        // The first two options are of course only possible if the line from lines is non-null -
                        // i.e. only option 3 is possible if we've overrun the end of the old file.
                        return (lines[toPos] && (applyHunk(hunkLines, toPos + 1, maxErrors - 1, hunkLinesI + 1, false, patchedLines, patchedLinesLength + 1) || applyHunk(hunkLines, toPos + 1, maxErrors - 1, hunkLinesI, false, patchedLines, patchedLinesLength + 1)) || applyHunk(hunkLines, toPos, maxErrors - 1, hunkLinesI + 1, false, patchedLines, patchedLinesLength));
                    }
                }
            }
            // Before returning, trim any unmodified context lines off the end of patchedLines and reduce
            // toPos (and thus oldLineLastI) accordingly. This allows later hunks to be applied to a region
            // that starts in this hunk's trailing context.
            patchedLinesLength -= nConsecutiveOldContextLines;
            toPos -= nConsecutiveOldContextLines;
            patchedLines.length = patchedLinesLength;
            return {
                patchedLines,
                oldLineLastI: toPos - 1
            };
        }
        const resultLines = [];
        // Search best fit offsets for each hunk based on the previous ones
        let prevHunkOffset = 0;
        for (let i = 0; i < hunks.length; i++) {
            const hunk = hunks[i];
            let hunkResult;
            const maxLine = lines.length - hunk.oldLines + fuzzFactor;
            let toPos;
            for (let maxErrors = 0; maxErrors <= fuzzFactor; maxErrors++) {
                toPos = hunk.oldStart + prevHunkOffset - 1;
                const iterator = distanceIterator(toPos, minLine, maxLine);
                for (; toPos !== undefined; toPos = iterator()) {
                    hunkResult = applyHunk(hunk.lines, toPos, maxErrors);
                    if (hunkResult) {
                        break;
                    }
                }
                if (hunkResult) {
                    break;
                }
            }
            if (!hunkResult) {
                return false;
            }
            // Copy everything from the end of where we applied the last hunk to the start of this hunk
            for (let i = minLine; i < toPos; i++) {
                resultLines.push(lines[i]);
            }
            // Add the lines produced by applying the hunk:
            for (let i = 0; i < hunkResult.patchedLines.length; i++) {
                const line = hunkResult.patchedLines[i];
                resultLines.push(line);
            }
            // Set lower text limit to end of the current hunk, so next ones don't try
            // to fit over already patched text
            minLine = hunkResult.oldLineLastI + 1;
            // Note the offset between where the patch said the hunk should've applied and where we
            // applied it, so we can adjust future hunks accordingly:
            prevHunkOffset = toPos + 1 - hunk.oldStart;
        }
        // Copy over the rest of the lines from the old text
        for (let i = minLine; i < lines.length; i++) {
            resultLines.push(lines[i]);
        }
        return resultLines.join('\n');
    }
    /**
     * applies one or more patches.
     *
     * `patch` may be either an array of structured patch objects, or a string representing a patch in unified diff format (which may patch one or more files).
     *
     * This method will iterate over the contents of the patch and apply to data provided through callbacks. The general flow for each patch index is:
     *
     * - `options.loadFile(index, callback)` is called. The caller should then load the contents of the file and then pass that to the `callback(err, data)` callback. Passing an `err` will terminate further patch execution.
     * - `options.patched(index, content, callback)` is called once the patch has been applied. `content` will be the return value from `applyPatch`. When it's ready, the caller should call `callback(err)` callback. Passing an `err` will terminate further patch execution.
     *
     * Once all patches have been applied or an error occurs, the `options.complete(err)` callback is made.
     */
    function applyPatches(uniDiff, options) {
        const spDiff = typeof uniDiff === 'string' ? parsePatch(uniDiff) : uniDiff;
        let currentIndex = 0;
        function processIndex() {
            const index = spDiff[currentIndex++];
            if (!index) {
                return options.complete();
            }
            options.loadFile(index, function (err, data) {
                if (err) {
                    return options.complete(err);
                }
                const updatedContent = applyPatch(data, index, options);
                options.patched(index, updatedContent, function (err) {
                    if (err) {
                        return options.complete(err);
                    }
                    processIndex();
                });
            });
        }
        processIndex();
    }

    function reversePatch(structuredPatch) {
        if (Array.isArray(structuredPatch)) {
            // (See comment in unixToWin for why we need the pointless-looking anonymous function here)
            return structuredPatch.map(patch => reversePatch(patch)).reverse();
        }
        return Object.assign(Object.assign({}, structuredPatch), { oldFileName: structuredPatch.newFileName, oldHeader: structuredPatch.newHeader, newFileName: structuredPatch.oldFileName, newHeader: structuredPatch.oldHeader, hunks: structuredPatch.hunks.map(hunk => {
                return {
                    oldLines: hunk.newLines,
                    oldStart: hunk.newStart,
                    newLines: hunk.oldLines,
                    newStart: hunk.oldStart,
                    lines: hunk.lines.map(l => {
                        if (l.startsWith('-')) {
                            return `+${l.slice(1)}`;
                        }
                        if (l.startsWith('+')) {
                            return `-${l.slice(1)}`;
                        }
                        return l;
                    })
                };
            }) });
    }

    function structuredPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, options) {
        let optionsObj;
        if (!options) {
            optionsObj = {};
        }
        else if (typeof options === 'function') {
            optionsObj = { callback: options };
        }
        else {
            optionsObj = options;
        }
        if (typeof optionsObj.context === 'undefined') {
            optionsObj.context = 4;
        }
        // We copy this into its own variable to placate TypeScript, which thinks
        // optionsObj.context might be undefined in the callbacks below.
        const context = optionsObj.context;
        // @ts-expect-error (runtime check for something that is correctly a static type error)
        if (optionsObj.newlineIsToken) {
            throw new Error('newlineIsToken may not be used with patch-generation functions, only with diffing functions');
        }
        if (!optionsObj.callback) {
            return diffLinesResultToPatch(diffLines(oldStr, newStr, optionsObj));
        }
        else {
            const { callback } = optionsObj;
            diffLines(oldStr, newStr, Object.assign(Object.assign({}, optionsObj), { callback: (diff) => {
                    const patch = diffLinesResultToPatch(diff);
                    // TypeScript is unhappy without the cast because it does not understand that `patch` may
                    // be undefined here only if `callback` is StructuredPatchCallbackAbortable:
                    callback(patch);
                } }));
        }
        function diffLinesResultToPatch(diff) {
            // STEP 1: Build up the patch with no "\ No newline at end of file" lines and with the arrays
            //         of lines containing trailing newline characters. We'll tidy up later...
            if (!diff) {
                return;
            }
            diff.push({ value: '', lines: [] }); // Append an empty value to make cleanup easier
            function contextLines(lines) {
                return lines.map(function (entry) { return ' ' + entry; });
            }
            const hunks = [];
            let oldRangeStart = 0, newRangeStart = 0, curRange = [], oldLine = 1, newLine = 1;
            for (let i = 0; i < diff.length; i++) {
                const current = diff[i], lines = current.lines || splitLines(current.value);
                current.lines = lines;
                if (current.added || current.removed) {
                    // If we have previous context, start with that
                    if (!oldRangeStart) {
                        const prev = diff[i - 1];
                        oldRangeStart = oldLine;
                        newRangeStart = newLine;
                        if (prev) {
                            curRange = context > 0 ? contextLines(prev.lines.slice(-context)) : [];
                            oldRangeStart -= curRange.length;
                            newRangeStart -= curRange.length;
                        }
                    }
                    // Output our changes
                    for (const line of lines) {
                        curRange.push((current.added ? '+' : '-') + line);
                    }
                    // Track the updated file position
                    if (current.added) {
                        newLine += lines.length;
                    }
                    else {
                        oldLine += lines.length;
                    }
                }
                else {
                    // Identical context lines. Track line changes
                    if (oldRangeStart) {
                        // Close out any changes that have been output (or join overlapping)
                        if (lines.length <= context * 2 && i < diff.length - 2) {
                            // Overlapping
                            for (const line of contextLines(lines)) {
                                curRange.push(line);
                            }
                        }
                        else {
                            // end the range and output
                            const contextSize = Math.min(lines.length, context);
                            for (const line of contextLines(lines.slice(0, contextSize))) {
                                curRange.push(line);
                            }
                            const hunk = {
                                oldStart: oldRangeStart,
                                oldLines: (oldLine - oldRangeStart + contextSize),
                                newStart: newRangeStart,
                                newLines: (newLine - newRangeStart + contextSize),
                                lines: curRange
                            };
                            hunks.push(hunk);
                            oldRangeStart = 0;
                            newRangeStart = 0;
                            curRange = [];
                        }
                    }
                    oldLine += lines.length;
                    newLine += lines.length;
                }
            }
            // Step 2: eliminate the trailing `\n` from each line of each hunk, and, where needed, add
            //         "\ No newline at end of file".
            for (const hunk of hunks) {
                for (let i = 0; i < hunk.lines.length; i++) {
                    if (hunk.lines[i].endsWith('\n')) {
                        hunk.lines[i] = hunk.lines[i].slice(0, -1);
                    }
                    else {
                        hunk.lines.splice(i + 1, 0, '\\ No newline at end of file');
                        i++; // Skip the line we just added, then continue iterating
                    }
                }
            }
            return {
                oldFileName: oldFileName, newFileName: newFileName,
                oldHeader: oldHeader, newHeader: newHeader,
                hunks: hunks
            };
        }
    }
    /**
     * creates a unified diff patch.
     * @param patch either a single structured patch object (as returned by `structuredPatch`) or an array of them (as returned by `parsePatch`)
     */
    function formatPatch(patch) {
        if (Array.isArray(patch)) {
            return patch.map(formatPatch).join('\n');
        }
        const ret = [];
        if (patch.oldFileName == patch.newFileName) {
            ret.push('Index: ' + patch.oldFileName);
        }
        ret.push('===================================================================');
        ret.push('--- ' + patch.oldFileName + (typeof patch.oldHeader === 'undefined' ? '' : '\t' + patch.oldHeader));
        ret.push('+++ ' + patch.newFileName + (typeof patch.newHeader === 'undefined' ? '' : '\t' + patch.newHeader));
        for (let i = 0; i < patch.hunks.length; i++) {
            const hunk = patch.hunks[i];
            // Unified Diff Format quirk: If the chunk size is 0,
            // the first number is one lower than one would expect.
            // https://www.artima.com/weblogs/viewpost.jsp?thread=164293
            if (hunk.oldLines === 0) {
                hunk.oldStart -= 1;
            }
            if (hunk.newLines === 0) {
                hunk.newStart -= 1;
            }
            ret.push('@@ -' + hunk.oldStart + ',' + hunk.oldLines
                + ' +' + hunk.newStart + ',' + hunk.newLines
                + ' @@');
            for (const line of hunk.lines) {
                ret.push(line);
            }
        }
        return ret.join('\n') + '\n';
    }
    function createTwoFilesPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, options) {
        if (typeof options === 'function') {
            options = { callback: options };
        }
        if (!(options === null || options === void 0 ? void 0 : options.callback)) {
            const patchObj = structuredPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, options);
            if (!patchObj) {
                return;
            }
            return formatPatch(patchObj);
        }
        else {
            const { callback } = options;
            structuredPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, Object.assign(Object.assign({}, options), { callback: patchObj => {
                    if (!patchObj) {
                        callback(undefined);
                    }
                    else {
                        callback(formatPatch(patchObj));
                    }
                } }));
        }
    }
    function createPatch(fileName, oldStr, newStr, oldHeader, newHeader, options) {
        return createTwoFilesPatch(fileName, fileName, oldStr, newStr, oldHeader, newHeader, options);
    }
    /**
     * Split `text` into an array of lines, including the trailing newline character (where present)
     */
    function splitLines(text) {
        const hasTrailingNl = text.endsWith('\n');
        const result = text.split('\n').map(line => line + '\n');
        if (hasTrailingNl) {
            result.pop();
        }
        else {
            result.push(result.pop().slice(0, -1));
        }
        return result;
    }

    /**
     * converts a list of change objects to the format returned by Google's [diff-match-patch](https://github.com/google/diff-match-patch) library
     */
    function convertChangesToDMP(changes) {
        const ret = [];
        let change, operation;
        for (let i = 0; i < changes.length; i++) {
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

    /**
     * converts a list of change objects to a serialized XML format
     */
    function convertChangesToXML(changes) {
        const ret = [];
        for (let i = 0; i < changes.length; i++) {
            const change = changes[i];
            if (change.added) {
                ret.push('<ins>');
            }
            else if (change.removed) {
                ret.push('<del>');
            }
            ret.push(escapeHTML(change.value));
            if (change.added) {
                ret.push('</ins>');
            }
            else if (change.removed) {
                ret.push('</del>');
            }
        }
        return ret.join('');
    }
    function escapeHTML(s) {
        let n = s;
        n = n.replace(/&/g, '&amp;');
        n = n.replace(/</g, '&lt;');
        n = n.replace(/>/g, '&gt;');
        n = n.replace(/"/g, '&quot;');
        return n;
    }

    exports.Diff = Diff;
    exports.applyPatch = applyPatch;
    exports.applyPatches = applyPatches;
    exports.arrayDiff = arrayDiff;
    exports.canonicalize = canonicalize;
    exports.characterDiff = characterDiff;
    exports.convertChangesToDMP = convertChangesToDMP;
    exports.convertChangesToXML = convertChangesToXML;
    exports.createPatch = createPatch;
    exports.createTwoFilesPatch = createTwoFilesPatch;
    exports.cssDiff = cssDiff;
    exports.diffArrays = diffArrays;
    exports.diffChars = diffChars;
    exports.diffCss = diffCss;
    exports.diffJson = diffJson;
    exports.diffLines = diffLines;
    exports.diffSentences = diffSentences;
    exports.diffTrimmedLines = diffTrimmedLines;
    exports.diffWords = diffWords;
    exports.diffWordsWithSpace = diffWordsWithSpace;
    exports.formatPatch = formatPatch;
    exports.jsonDiff = jsonDiff;
    exports.lineDiff = lineDiff;
    exports.parsePatch = parsePatch;
    exports.reversePatch = reversePatch;
    exports.sentenceDiff = sentenceDiff;
    exports.structuredPatch = structuredPatch;
    exports.wordDiff = wordDiff;
    exports.wordsWithSpaceDiff = wordsWithSpaceDiff;

}));
