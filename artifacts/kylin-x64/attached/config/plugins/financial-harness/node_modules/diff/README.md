# jsdiff

A JavaScript text differencing implementation. Try it out in the **[online demo](https://kpdecker.github.io/jsdiff)**.

Based on the algorithm proposed in
["An O(ND) Difference Algorithm and its Variations" (Myers, 1986)](http://www.xmailserver.org/diff2.pdf).

## Installation
```bash
npm install diff --save
```

## Getting started

### Imports

In an environment where you can use imports, everything you need can be imported directly from `diff`. e.g.

ESM:

```
import {diffChars, createPatch} from 'diff';
```

CommonJS

```
const {diffChars, createPatch} = require('diff');
```

If you want to serve jsdiff to a web page without using a module system, you can use `dist/diff.js` or `dist/diff.min.js`. These create a global called `Diff` that contains the entire JsDiff API as its properties.

### Usage

jsdiff's diff functions all take an old text and a new text and perform three steps:

1. Split both texts into arrays of "tokens". What constitutes a token varies; in `diffChars`, each character is a token, while in `diffLines`, each line is a token.

2. Find the smallest set of single-token *insertions* and *deletions* needed to transform the first array of tokens into the second.

   This step depends upon having some notion of a token from the old array being "equal" to one from the new array, and this notion of equality affects the results. Usually two tokens are equal if `===` considers them equal, but some of the diff functions use an alternative notion of equality or have options to configure it. For instance, by default `diffChars("Foo", "FOOD")` will require two deletions (`o`, `o`) and three insertions (`O`, `O`, `D`), but `diffChars("Foo", "FOOD", {ignoreCase: true})` will require just one insertion (of a `D`), since `ignoreCase` causes `o` and `O` to be considered equal.

3. Return an array representing the transformation computed in the previous step as a series of [change objects](#change-objects). The array is ordered from the start of the input to the end, and each change object represents *inserting* one or more tokens, *deleting* one or more tokens, or *keeping* one or more tokens.

## API

* `diffChars(oldStr, newStr[, options])` - diffs two blocks of text, treating each character as a token.

    ("Characters" here means Unicode code points - the elements you get when you loop over a string with a `for ... of ...` loop.)

    Returns a list of [change objects](#change-objects).

    Options
    * `ignoreCase`: If `true`, the uppercase and lowercase forms of a character are considered equal. Defaults to `false`.

* `diffWords(oldStr, newStr[, options])` - diffs two blocks of text, treating each word and each punctuation mark as a token. Whitespace is ignored when computing the diff (but preserved as far as possible in the final change objects).

    Returns a list of [change objects](#change-objects).

    Options
    * `ignoreCase`: Same as in `diffChars`. Defaults to false.
    * `intlSegmenter`: An optional [`Intl.Segmenter`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter) object (which must have a `granularity` of `'word'`) for `diffWords` to use to split the text into words.

      By default, `diffWords` does not use an `Intl.Segmenter`, just some regexes for splitting text into words. This will tend to give worse results than `Intl.Segmenter` would, but ensures the results are consistent across environments; `Intl.Segmenter` behaviour is only loosely specced and the implementations in browsers could in principle change dramatically in future. If you want to use `diffWords` with an `Intl.Segmenter` but ensure it behaves the same whatever environment you run it in, use an `Intl.Segmenter` polyfill instead of the JavaScript engine's native `Intl.Segmenter` implementation.

      Using an `Intl.Segmenter` should allow better word-level diffing of non-English text than the default behaviour. For instance, `Intl.Segmenter`s can generally identify via built-in dictionaries which sequences of adjacent Chinese characters form words, allowing word-level diffing of Chinese. By specifying a language when instantiating the segmenter (e.g. `new Intl.Segmenter('sv', {granularity: 'word'})`) you can also support language-specific rules, like treating Swedish's colon separated contractions (like *k:a* for *kyrka*) as single words; by default this would be seen as two words separated by a colon.

* `diffWordsWithSpace(oldStr, newStr[, options])` - diffs two blocks of text, treating each word, punctuation mark, newline, or run of (non-newline) whitespace as a token.

* `diffLines(oldStr, newStr[, options])` - diffs two blocks of text, treating each line as a token.

    Options
    * `ignoreWhitespace`: `true` to ignore leading and trailing whitespace characters when checking if two lines are equal. Defaults to `false`.
    * `ignoreNewlineAtEof`: `true` to ignore a missing newline character at the end of the last line when comparing it to other lines. (By default, the line `'b\n'` in text `'a\nb\nc'` is not considered equal to the line `'b'` in text `'a\nb'`; this option makes them be considered equal.) Ignored if `ignoreWhitespace` or `newlineIsToken` are also true.
    * `stripTrailingCr`: `true` to remove all trailing CR (`\r`) characters before performing the diff. Defaults to `false`.
      This helps to get a useful diff when diffing UNIX text files against Windows text files.
    * `newlineIsToken`: `true` to treat the newline character at the end of each line as its own token. This allows for changes to the newline structure to occur independently of the line content and to be treated as such. In general this is the more human friendly form of `diffLines`; the default behavior with this option turned off is better suited for patches and other computer friendly output. Defaults to `false`.

    Note that while using `ignoreWhitespace` in combination with `newlineIsToken` is not an error, results may not be as expected. With `ignoreWhitespace: true` and `newlineIsToken: false`, changing a completely empty line to contain some spaces is treated as a non-change, but with `ignoreWhitespace: true` and `newlineIsToken: true`, it is treated as an insertion. This is because the content of a completely blank line is not a token at all in `newlineIsToken` mode.

    Returns a list of [change objects](#change-objects).

* `diffSentences(oldStr, newStr[, options])` - diffs two blocks of text, treating each sentence, and the whitespace between each pair of sentences, as a token. The characters `.`, `!`, and `?`, when followed by whitespace, are treated as marking the end of a sentence; nothing else besides the end of the string is considered to mark a sentence end.

  (For more sophisticated detection of sentence breaks, including support for non-English punctuation, consider instead tokenizing with an [`Intl.Segmenter`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter) with `granularity: 'sentence'` and passing the result to `diffArrays`.)

    Returns a list of [change objects](#change-objects).

* `diffCss(oldStr, newStr[, options])` - diffs two blocks of text, comparing CSS tokens.

    Returns a list of [change objects](#change-objects).

* `diffJson(oldObj, newObj[, options])` - diffs two JSON-serializable objects by first serializing them to prettily-formatted JSON and then treating each line of the JSON as a token. Object properties are ordered alphabetically in the serialized JSON, so the order of properties in the objects being compared doesn't affect the result.

    Returns a list of [change objects](#change-objects).
    
    Options
    * `stringifyReplacer`: A custom replacer function. Operates similarly to the `replacer` parameter to [`JSON.stringify()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify#the_replacer_parameter), but must be a function.
    *  `undefinedReplacement`: A value to replace `undefined` with. Ignored if a `stringifyReplacer` is provided.

* `diffArrays(oldArr, newArr[, options])` - diffs two arrays of tokens, comparing each item for strict equality (===).

    Options
    * `comparator`: `function(left, right)` for custom equality checks

    Returns a list of [change objects](#change-objects).

* `createTwoFilesPatch(oldFileName, newFileName, oldStr, newStr[, oldHeader[, newHeader[, options]]])` - creates a unified diff patch by first computing a diff with `diffLines` and then serializing it to unified diff format.

    Parameters:
    * `oldFileName` : String to be output in the filename section of the patch for the removals
    * `newFileName` : String to be output in the filename section of the patch for the additions
    * `oldStr` : Original string value
    * `newStr` : New string value
    * `oldHeader` : Optional additional information to include in the old file header. Default: `undefined`.
    * `newHeader` : Optional additional information to include in the new file header. Default: `undefined`.
    * `options` : An object with options. 
      - `context` describes how many lines of context should be included. You can set this to `Number.MAX_SAFE_INTEGER` or `Infinity` to include the entire file content in one hunk.
      - `ignoreWhitespace`: Same as in `diffLines`. Defaults to `false`.
      - `stripTrailingCr`: Same as in `diffLines`. Defaults to `false`.

* `createPatch(fileName, oldStr, newStr[, oldHeader[, newHeader[, options]]])` - creates a unified diff patch.

    Just like createTwoFilesPatch, but with oldFileName being equal to newFileName.

* `formatPatch(patch)` - creates a unified diff patch.

    `patch` may be either a single structured patch object (as returned by `structuredPatch`) or an array of them (as returned by `parsePatch`).

* `structuredPatch(oldFileName, newFileName, oldStr, newStr[, oldHeader[, newHeader[, options]]])` - returns an object with an array of hunk objects.

    This method is similar to createTwoFilesPatch, but returns a data structure
    suitable for further processing. Parameters are the same as createTwoFilesPatch. The data structure returned may look like this:

    ```js
    {
      oldFileName: 'oldfile', newFileName: 'newfile',
      oldHeader: 'header1', newHeader: 'header2',
      hunks: [{
        oldStart: 1, oldLines: 3, newStart: 1, newLines: 3,
        lines: [' line2', ' line3', '-line4', '+line5', '\\ No newline at end of file'],
      }]
    }
    ```

* `applyPatch(source, patch[, options])` - attempts to apply a unified diff patch.

    Hunks are applied first to last. `applyPatch` first tries to apply the first hunk at the line number specified in the hunk header, and with all context lines matching exactly. If that fails, it tries scanning backwards and forwards, one line at a time, to find a place to apply the hunk where the context lines match exactly. If that still fails, and `fuzzFactor` is greater than zero, it increments the maximum number of mismatches (missing, extra, or changed context lines) that there can be between the hunk context and a region where we are trying to apply the patch such that the hunk will still be considered to match. Regardless of `fuzzFactor`, lines to be deleted in the hunk *must* be present for a hunk to match, and the context lines *immediately* before and after an insertion must match exactly.

    Once a hunk is successfully fitted, the process begins again with the next hunk. Regardless of `fuzzFactor`, later hunks must be applied later in the file than earlier hunks.

    If a hunk cannot be successfully fitted *anywhere* with fewer than `fuzzFactor` mismatches, `applyPatch` fails and returns `false`.

    If a hunk is successfully fitted but not at the line number specified by the hunk header, all subsequent hunks have their target line number adjusted accordingly. (e.g. if the first hunk is applied 10 lines below where the hunk header said it should fit, `applyPatch` will *start* looking for somewhere to apply the second hunk 10 lines below where its hunk header says it goes.)

    If the patch was applied successfully, returns a string containing the patched text. If the patch could not be applied (because some hunks in the patch couldn't be fitted to the text in `source`), `applyPatch` returns false.

    `patch` may be a string diff or the output from the `parsePatch` or `structuredPatch` methods.

    The optional `options` object may have the following keys:

    - `fuzzFactor`: Maximum Levenshtein distance (in lines deleted, added, or subtituted) between the context shown in a patch hunk and the lines found in the file. Defaults to 0.
    - `autoConvertLineEndings`: If `true`, and if the file to be patched consistently uses different line endings to the patch (i.e. either the file always uses Unix line endings while the patch uses Windows ones, or vice versa), then `applyPatch` will behave as if the line endings in the patch were the same as those in the source file. (If `false`, the patch will usually fail to apply in such circumstances since lines deleted in the patch won't be considered to match those in the source file.) Defaults to `true`.
    - `compareLine(lineNumber, line, operation, patchContent)`: Callback used to compare to given lines to determine if they should be considered equal when patching. Defaults to strict equality but may be overridden to provide fuzzier comparison. Should return false if the lines should be rejected.

* `applyPatches(patch, options)` - applies one or more patches.

    `patch` may be either an array of structured patch objects, or a string representing a patch in unified diff format (which may patch one or more files).

    This method will iterate over the contents of the patch and apply to data provided through callbacks. The general flow for each patch index is:

    - `options.loadFile(index, callback)` is called. The caller should then load the contents of the file and then pass that to the `callback(err, data)` callback. Passing an `err` will terminate further patch execution.
    - `options.patched(index, content, callback)` is called once the patch has been applied. `content` will be the return value from `applyPatch`. When it's ready, the caller should call `callback(err)` callback. Passing an `err` will terminate further patch execution.

    Once all patches have been applied or an error occurs, the `options.complete(err)` callback is made.

* `parsePatch(diffStr)` - Parses a patch into structured data

    Return a JSON object representation of the a patch, suitable for use with the `applyPatch` method. This parses to the same structure returned by `structuredPatch`.

* `reversePatch(patch)` - Returns a new structured patch which when applied will undo the original `patch`.

    `patch` may be either a single structured patch object (as returned by `structuredPatch`) or an array of them (as returned by `parsePatch`).

* `convertChangesToXML(changes)` - converts a list of change objects to a serialized XML format

* `convertChangesToDMP(changes)` - converts a list of change objects to the format returned by Google's [diff-match-patch](https://github.com/google/diff-match-patch) library

#### Universal `options`

Certain options can be provided in the `options` object of *any* method that calculates a diff (including `diffChars`, `diffLines` etc. as well as `structuredPatch`, `createPatch`, and `createTwoFilesPatch`):

* `callback`: if provided, the diff will be computed in async mode to avoid blocking the event loop while the diff is calculated. The value of the `callback` option should be a function and will be passed the computed diff or patch as its first argument.

  (Note that if the ONLY option you want to provide is a callback, you can pass the callback function directly as the `options` parameter instead of passing an object with a `callback` property.)

* `maxEditLength`: a number specifying the maximum edit distance to consider between the old and new texts. You can use this to limit the computational cost of diffing large, very different texts by giving up early if the cost will be huge. This option can be passed either to diffing functions (`diffLines`, `diffChars`, etc) or to patch-creation function (`structuredPatch`, `createPatch`, etc), all of which will indicate that the max edit length was reached by returning `undefined` instead of whatever they'd normally return.

* `timeout`: a number of milliseconds after which the diffing algorithm will abort and return `undefined`. Supported by the same functions as `maxEditLength`.

* `oneChangePerToken`: if `true`, the array of change objects returned will contain one change object per token (e.g. one per line if calling `diffLines`), instead of runs of consecutive tokens that are all added / all removed / all conserved being combined into a single change object.

### Defining custom diffing behaviors

If you need behavior a little different to what any of the text diffing functions above offer, you can roll your own by customizing both the tokenization behavior used and the notion of equality used to determine if two tokens are equal.

The simplest way to customize tokenization behavior is to simply tokenize the texts you want to diff yourself, with your own code, then pass the arrays of tokens to `diffArrays`. For instance, if you wanted a semantically-aware diff of some code, you could try tokenizing it using a parser specific to the programming language the code is in, then passing the arrays of tokens to `diffArrays`.

To customize the notion of token equality used, use the `comparator` option to `diffArrays`.

For even more customisation of the diffing behavior, you can extend the `Diff()` class, override its `castInput`, `tokenize`, `removeEmpty`, `equals`, and `join` properties with your own functions, then call its `diff(oldString, newString[, options])` method. The methods you can override are used as follows:

* `castInput(value, options)`: used to transform the `oldString` and `newString` before any other steps in the diffing algorithm happen. For instance, `diffJson` uses `castInput` to serialize the objects being diffed to JSON. Defaults to a no-op.
* `tokenize(value, options)`: used to convert each of `oldString` and `newString` (after they've gone through `castInput`) to an array of tokens. Defaults to returning `value.split('')` (returning an array of individual characters).
* `removeEmpty(array)`: called on the arrays of tokens returned by `tokenize` and can be used to modify them. Defaults to stripping out falsey tokens, such as empty strings. `diffArrays` overrides this to simply return the `array`, which means that falsey values like empty strings can be handled like any other token by `diffArrays`.
* `equals(left, right, options)`: called to determine if two tokens (one from the old string, one from the new string) should be considered equal. Defaults to comparing them with `===`.
* `join(tokens)`: gets called with an array of consecutive tokens that have either all been added, all been removed, or are all common. Needs to join them into a single value that can be used as the `value` property of the [change object](#change-objects) for these tokens. Defaults to simply returning `tokens.join('')` (and therefore by default will error out if your tokens are not strings; differs that support non-string tokens like `diffArrays` should override it to be a no-op to fix this).
* `postProcess(changeObjects, options)`: gets called at the end of the algorithm with the [change objects](#change-objects) produced, and can do final cleanups on them. Defaults to simply returning `changeObjects` unchanged.

### Change Objects
Many of the methods above return change objects. These objects consist of the following fields:

* `value`: The concatenated content of all the tokens represented by this change object - i.e. generally the text that is either added, deleted, or common, as a single string. In cases where tokens are considered common but are non-identical (e.g. because an option like `ignoreCase` or a custom `comparator` was used), the value from the *new* string will be provided here.
* `added`: true if the value was inserted into the new string, otherwise false
* `removed`: true if the value was removed from the old string, otherwise false
* `count`: How many tokens (e.g. chars for `diffChars`, lines for `diffLines`) the value in the change object consists of

(Change objects where `added` and `removed` are both false represent content that is common to the old and new strings.)

## Examples

#### Basic example in Node

```js
require('colors');
const {diffChars} = require('diff');

const one = 'beep boop';
const other = 'beep boob blah';

const diff = diffChars(one, other);

diff.forEach((part) => {
  // green for additions, red for deletions
  let text = part.added ? part.value.bgGreen :
             part.removed ? part.value.bgRed :
                            part.value;
  process.stderr.write(text);
});

console.log();
```
Running the above program should yield

<img src="images/node_example.png" alt="Node Example">

#### Basic example in a web page

```html
<pre id="display"></pre>
<script src="diff.js"></script>
<script>
const one = 'beep boop',
    other = 'beep boob blah',
    color = '';
    
let span = null;

const diff = Diff.diffChars(one, other),
    display = document.getElementById('display'),
    fragment = document.createDocumentFragment();

diff.forEach((part) => {
  // green for additions, red for deletions
  // grey for common parts
  const color = part.added ? 'green' :
    part.removed ? 'red' : 'grey';
  span = document.createElement('span');
  span.style.color = color;
  span.appendChild(document
    .createTextNode(part.value));
  fragment.appendChild(span);
});

display.appendChild(fragment);
</script>
```

Open the above .html file in a browser and you should see

<img src="images/web_example.png" alt="Node Example">

#### Example of generating a patch from Node

The code below is roughly equivalent to the Unix command `diff -u file1.txt file2.txt > mydiff.patch`:

```
const {createTwoFilesPatch} = require('diff');
const file1Contents = fs.readFileSync("file1.txt").toString();
const file2Contents = fs.readFileSync("file2.txt").toString();
const patch = createTwoFilesPatch("file1.txt", "file2.txt", file1Contents, file2Contents);
fs.writeFileSync("mydiff.patch", patch);
```

#### Examples of parsing and applying a patch from Node

##### Applying a patch to a specified file

The code below is roughly equivalent to the Unix command `patch file1.txt mydiff.patch`:

```
const {applyPatch} = require('diff');
const file1Contents = fs.readFileSync("file1.txt").toString();
const patch = fs.readFileSync("mydiff.patch").toString();
const patchedFile = applyPatch(file1Contents, patch);
fs.writeFileSync("file1.txt", patchedFile);
```

##### Applying a multi-file patch to the files specified by the patch file itself

The code below is roughly equivalent to the Unix command `patch < mydiff.patch`:

```
const {applyPatches} = require('diff');
const patch = fs.readFileSync("mydiff.patch").toString();
applyPatches(patch, {
    loadFile: (patch, callback) => {
        let fileContents;
        try {
            fileContents = fs.readFileSync(patch.oldFileName).toString();
        } catch (e) {
            callback(`No such file: ${patch.oldFileName}`);
            return;
        }
        callback(undefined, fileContents);
    },
    patched: (patch, patchedContent, callback) => {
        if (patchedContent === false) {
            callback(`Failed to apply patch to ${patch.oldFileName}`)
            return;
        }
        fs.writeFileSync(patch.oldFileName, patchedContent);
        callback();
    },
    complete: (err) => {
        if (err) {
            console.log("Failed with error:", err);
        }
    }
});
```

## Compatibility

jsdiff should support all ES5 environments. If you find one that it doesn't support, please [open an issue](https://github.com/kpdecker/jsdiff/issues).

## TypeScript

As of version 8, JsDiff ships with type definitions. From version 8 onwards, you should not depend on the `@types/diff` package.

One tricky pattern pervades the type definitions and is worth explaining here. Most diff-generating and patch-generating functions (`diffChars`, `diffWords`, `structuredPatch`, etc) can be run in async mode (by providing a `callback` option), in abortable mode (by passing a `timeout` or `maxEditLength` property), or both. This is awkward for typing, because these modes have different call signatures:
  * in abortable mode, the result *might* be `undefined`, and
  * in async mode, the result (which *might* be allowed to be `undefined`, depending upon whether we're in abortable mode) is passed to the provide callback instead of being returned, and the return value is always `undefined`

Our type definitions handle this as best they can by declaring different types for multiple [overload signatures](https://www.typescriptlang.org/docs/handbook/2/functions.html#function-overloads) for each such function - and also by declaring different types for abortable and nonabortable options objects. For instance, an object of type `DiffCharsOptionsAbortable` is valid to pass as the `options` argument to `diffChars` and represents an *abortable* call (whose result may be `undefined`) since it necessarily contains either the `timeout` or `maxEditLength` property.

This approach, while probably the least bad way available to add types to JsDiff without radically refactoring the library's API, does not yield perfect results. *As long as* TypeScript is able to statically determine the type of your options, and therefore which overload signature is appropriate, everything should work fine. This should always be the case if you are passing an object literal as the `options` argument and inlining the definition of any `callback` function within that literal. But in cases where TypeScript *cannot* manage to do this - as may often be the case if you, say, define an `options: any = {}` object, build up your options programmatically, and then pass the result to a JsDiff function - then it is likely to fail to match the correct overload signature (probably defaulting to assuming you are calling the function in non-abortable, non-async mode), potentially causing type errors. You can either ignore (e.g. with `@ts-expect-error`) any such errors, or try to avoid them by refactoring your code so that TypeScript can always statically determine the type of the options you pass.

## License

See [LICENSE](https://github.com/kpdecker/jsdiff/blob/master/LICENSE).

## Deviations from the published Myers diff algorithm

jsdiff deviates from the published algorithm in a couple of ways that don't affect results but do affect performance:

* jsdiff keeps track of the diff for each diagonal using a linked list of change objects for each diagonal, rather than the historical array of furthest-reaching D-paths on each diagonal contemplated on page 8 of Myers's paper.
* jsdiff skips considering diagonals where the furthest-reaching D-path would go off the edge of the edit graph. This dramatically reduces the time cost (from quadratic to linear) in cases where the new text just appends or truncates content at the end of the old text.
