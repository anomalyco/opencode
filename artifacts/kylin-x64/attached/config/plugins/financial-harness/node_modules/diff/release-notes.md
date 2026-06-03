# Release Notes

## 8.0.2

- [#616](https://github.com/kpdecker/jsdiff/pull/616) **Restored compatibility of `diffSentences` with old Safari versions.** This was broken in 8.0.0 by the introduction of a regex with a [lookbehind assertion](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Lookbehind_assertion); these weren't supported in Safari prior to version 16.4.
- [#612](https://github.com/kpdecker/jsdiff/pull/612) **Improved tree shakeability** by marking the built CJS and ESM packages with `sideEffects: false`.

## 8.0.1

- [#610](https://github.com/kpdecker/jsdiff/pull/610) **Fixes types for `diffJson` which were broken by 8.0.0**. The new bundled types in 8.0.0 only allowed `diffJson` to be passed string arguments, but it should've been possible to pass either strings or objects (and now is). Thanks to Josh Kelley for the fix.

## 8.0.0

- [#580](https://github.com/kpdecker/jsdiff/pull/580) **Multiple tweaks to `diffSentences`**:
  * tokenization no longer takes quadratic time on pathological inputs (reported as a ReDOS vulnerability by Snyk); is now linear instead
  * the final sentence in the string is now handled the same by the tokenizer regardless of whether it has a trailing punctuation mark or not. (Previously, "foo. bar." tokenized to `["foo.", " ", "bar."]` but "foo. bar" tokenized to `["foo.", " bar"]` - i.e. whether the space between sentences was treated as a separate token depended upon whether the final sentence had trailing punctuation or not. This was arbitrary and surprising; it is no longer the case.)
  * in a string that starts with a sentence end, like "! hello.", the "!" is now treated as a separate sentence
  * the README now correctly documents the tokenization behaviour (it was wrong before)
- [#581](https://github.com/kpdecker/jsdiff/pull/581) - **fixed some regex operations used for tokenization in `diffWords` taking O(n^2) time** in pathological cases
- [#595](https://github.com/kpdecker/jsdiff/pull/595) - **fixed a crash in patch creation functions when handling a single hunk consisting of a very large number (e.g. >130k) of lines**. (This was caused by spreading indefinitely-large arrays to `.push()` using `.apply` or the spread operator and hitting the JS-implementation-specific limit on the maximum number of arguments to a function, as shown at https://stackoverflow.com/a/56809779/1709587; thus the exact threshold to hit the error will depend on the environment in which you were running JsDiff.)
- [#596](https://github.com/kpdecker/jsdiff/pull/596) - **removed the `merge` function**. Previously JsDiff included an undocumented function called `merge` that was meant to, in some sense, merge patches. It had at least a couple of serious bugs that could lead to it returning unambiguously wrong results, and it was difficult to simply "fix" because it was [unclear precisely what it was meant to do](https://github.com/kpdecker/jsdiff/issues/181#issuecomment-2198319542). For now, the fix is to remove it entirely.
- [#591](https://github.com/kpdecker/jsdiff/pull/591) - JsDiff's source code has been rewritten in TypeScript. This change entails the following changes for end users:
  * **the `diff` package on npm now includes its own TypeScript type definitions**. Users who previously used the `@types/diff` npm package from DefinitelyTyped should remove that dependency when upgrading JsDiff to v8.

    Note that the transition from the DefinitelyTyped types to JsDiff's own type definitions includes multiple fixes and also removes many exported types previously used for `options` arguments to diffing and patch-generation functions. (There are now different exported options types for abortable calls - ones with a `timeout` or `maxEditLength` that may give a result of `undefined` - and non-abortable calls.) See the TypeScript section of the README for some usage tips.

  * **The `Diff` object is now a class**. Custom extensions of `Diff`, as described in the "Defining custom diffing behaviors" section of the README, can therefore now be done by writing a `class CustomDiff extends Diff` and overriding methods, instead of the old way based on prototype inheritance. (I *think* code that did things the old way should still work, though!)

  * **`diff/lib/index.es6.js` and `diff/lib/index.mjs` no longer exist, and the ESM version of the library is no longer bundled into a single file.**

  * **The `ignoreWhitespace` option for `diffWords` is no longer included in the type declarations**. The effect of passing `ignoreWhitespace: true` has always been to make `diffWords` just call `diffWordsWithSpace` instead, which was confusing, because that behaviour doesn't seem properly described as "ignoring" whitespace at all. The property remains available to non-TypeScript applications for the sake of backwards compatability, but TypeScript applications will now see a type error if they try to pass `ignoreWhitespace: true` to `diffWords` and should change their code to call `diffWordsWithSpace` instead.

  * JsDiff no longer purports to support ES3 environments. (I'm pretty sure it never truly did, despite claiming to in its README, since even the 1.0.0 release used `Array.map` which was added in ES5.)
- [#601](https://github.com/kpdecker/jsdiff/pull/601) - **`diffJson`'s `stringifyReplacer` option behaves more like `JSON.stringify`'s `replacer` argument now.** In particular:
  * Each key/value pair now gets passed through the replacer once instead of twice
  * The `key` passed to the replacer when the top-level object is passed in as `value` is now `""` (previously, was `undefined`), and the `key` passed with an array element is the array index as a string, like `"0"` or `"1"` (previously was whatever the key for the entire array was). Both the new behaviours match that of `JSON.stringify`.
- [#602](https://github.com/kpdecker/jsdiff/pull/602) - **diffing functions now consistently return `undefined` when called in async mode** (i.e. with a callback). Previously, there was an odd quirk where they would return `true` if the strings being diffed were equal and `undefined` otherwise.

## 7.0.0

Just a single (breaking) bugfix, undoing a behaviour change introduced accidentally in 6.0.0:

- [#554](https://github.com/kpdecker/jsdiff/pull/554) **`diffWords` treats numbers and underscores as word characters again.** This behaviour was broken in v6.0.0.

## 6.0.0

This is a release containing many, *many* breaking changes. The objective of this release was to carry out a mass fix, in one go, of all the open bugs and design problems that required breaking changes to fix. A substantial, but exhaustive, changelog is below.

[Commits](https://github.com/kpdecker/jsdiff/compare/v5.2.0...v6.0.0)

- [#497](https://github.com/kpdecker/jsdiff/pull/497) **`diffWords` behavior has been radically changed.** Previously, even with `ignoreWhitespace: true`, runs of whitespace were tokens, which led to unhelpful and unintuitive diffing behavior in typical texts. Specifically, even when two texts contained overlapping passages, `diffWords` would sometimes choose to delete all the words from the old text and insert them anew in their new positions in order to avoid having to delete or insert whitespace tokens. Whitespace sequences are no longer tokens as of this release, which affects both the generated diffs and the `count`s.

  Runs of whitespace are still tokens in `diffWordsWithSpace`.

  As part of the changes to `diffWords`, **a new `.postProcess` method has been added on the base `Diff` type**, which can be overridden in custom `Diff` implementations.

  **`diffLines` with `ignoreWhitespace: true` will no longer ignore the insertion or deletion of entire extra lines of whitespace at the end of the text**. Previously, these would not show up as insertions or deletions, as a side effect of a hack in the base diffing algorithm meant to help ignore whitespace in `diffWords`. More generally, **the undocumented special handling in the core algorithm for ignored terminals has been removed entirely.** (This special case behavior used to rewrite the final two change objects in a scenario where the final change object was an addition or deletion and its `value` was treated as equal to the empty string when compared using the diff object's `.equals` method.)

- [#500](https://github.com/kpdecker/jsdiff/pull/500) **`diffChars` now diffs Unicode code points** instead of UTF-16 code units.
- [#508](https://github.com/kpdecker/jsdiff/pull/508) **`parsePatch` now always runs in what was previously "strict" mode; the undocumented `strict` option has been removed.** Previously, by default, `parsePatch` (and other patch functions that use it under the hood to parse patches) would accept a patch where the line counts in the headers were inconsistent with the actual patch content - e.g. where a hunk started with the header `@@ -1,3 +1,6 @@`, indicating that the content below spanned 3 lines in the old file and 6 lines in the new file, but then the actual content below the header consisted of some different number of lines, say 10 lines of context, 5 deletions, and 1 insertion. Actually trying to work with these patches using `applyPatch` or `merge`, however, would produce incorrect results instead of just ignoring the incorrect headers, making this "feature" more of a trap than something actually useful. It's been ripped out, and now we are always "strict" and will reject patches where the line counts in the headers aren't consistent with the actual patch content.
- [#435](https://github.com/kpdecker/jsdiff/pull/435) **Fix `parsePatch` handling of control characters.** `parsePatch` used to interpret various unusual control characters - namely vertical tabs, form feeds, lone carriage returns without a line feed, and EBCDIC NELs - as line breaks when parsing a patch file. This was inconsistent with the behavior of both JsDiff's own `diffLines` method and also the Unix `diff` and `patch` utils, which all simply treat those control characters as ordinary characters. The result of this discrepancy was that some well-formed patches - produced either by `diff` or by JsDiff itself and handled properly by the `patch` util - would be wrongly parsed by `parsePatch`, with the effect that it would disregard the remainder of a hunk after encountering one of these control characters.
- [#439](https://github.com/kpdecker/jsdiff/pull/439) **Prefer diffs that order deletions before insertions.** When faced with a choice between two diffs with an equal total edit distance, the Myers diff algorithm generally prefers one that does deletions before insertions rather than insertions before deletions. For instance, when diffing `abcd` against `acbd`, it will prefer a diff that says to delete the `b` and then insert a new `b` after the `c`, over a diff that says to insert a `c` before the `b` and then delete the existing `c`. JsDiff deviated from the published Myers algorithm in a way that led to it having the opposite preference in many cases, including that example. This is now fixed, meaning diffs output by JsDiff will more accurately reflect what the published Myers diff algorithm would output.
- [#455](https://github.com/kpdecker/jsdiff/pull/455) **The `added` and `removed` properties of change objects are now guaranteed to be set to a boolean value.** (Previously, they would be set to `undefined` or omitted entirely instead of setting them to false.)
- [#464](https://github.com/kpdecker/jsdiff/pull/464) Specifying `{maxEditLength: 0}` now sets a max edit length of 0 instead of no maximum.
- [#460](https://github.com/kpdecker/jsdiff/pull/460) **Added `oneChangePerToken` option.**
- [#467](https://github.com/kpdecker/jsdiff/pull/467) **Consistent ordering of arguments to `comparator(left, right)`.** Values from the old array will now consistently be passed as the first argument (`left`) and values from the new array as the second argument (`right`). Previously this was almost (but not quite) always the other way round.
- [#480](https://github.com/kpdecker/jsdiff/pull/480) **Passing `maxEditLength` to `createPatch` & `createTwoFilesPatch` now works properly** (i.e. returns undefined if the max edit distance is exceeded; previous behavior was to crash with a `TypeError` if the edit distance was exceeded).
- [#486](https://github.com/kpdecker/jsdiff/pull/486) **The `ignoreWhitespace` option of `diffLines` behaves more sensibly now.** `value`s in returned change objects now include leading/trailing whitespace even when `ignoreWhitespace` is used, just like how with `ignoreCase` the `value`s still reflect the case of one of the original texts instead of being all-lowercase. `ignoreWhitespace` is also now compatible with `newlineIsToken`. Finally, **`diffTrimmedLines` is deprecated** (and removed from the docs) in favour of using `diffLines` with `ignoreWhitespace: true`; the two are, and always have been, equivalent.
- [#490](https://github.com/kpdecker/jsdiff/pull/490) **When calling diffing functions in async mode by passing a `callback` option, the diff result will now be passed as the *first* argument to the callback instead of the second.** (Previously, the first argument was never used at all and would always have value `undefined`.)
- [#489](github.com/kpdecker/jsdiff/pull/489) **`this.options` no longer exists on `Diff` objects.** Instead, `options` is now passed as an argument to methods that rely on options, like `equals(left, right, options)`. This fixes a race condition in async mode, where diffing behaviour could be changed mid-execution if a concurrent usage of the same `Diff` instances overwrote its `options`.
- [#518](https://github.com/kpdecker/jsdiff/pull/518) **`linedelimiters` no longer exists** on patch objects; instead, when a patch with Windows-style CRLF line endings is parsed, **the lines in `lines` will end with `\r`**. There is now a **new `autoConvertLineEndings` option, on by default**, which makes it so that when a patch with Windows-style line endings is applied to a source file with Unix style line endings, the patch gets autoconverted to use Unix-style line endings, and when a patch with Unix-style line endings is applied to a source file with Windows-style line endings, it gets autoconverted to use Windows-style line endings.
- [#521](https://github.com/kpdecker/jsdiff/pull/521) **the `callback` option is now supported by `structuredPatch`, `createPatch`, and `createTwoFilesPatch`**
- [#529](https://github.com/kpdecker/jsdiff/pull/529) **`parsePatch` can now parse patches where lines starting with `--` or `++` are deleted/inserted**; previously, there were edge cases where the parser would choke on valid patches or give wrong results.
- [#530](https://github.com/kpdecker/jsdiff/pull/530) **Added `ignoreNewlineAtEof` option to `diffLines`**
- [#533](https://github.com/kpdecker/jsdiff/pull/533) **`applyPatch` uses an entirely new algorithm for fuzzy matching.** Differences between the old and new algorithm are as follows:
  * The `fuzzFactor` now indicates the maximum [*Levenshtein* distance](https://en.wikipedia.org/wiki/Levenshtein_distance) that there can be between the context shown in a hunk and the actual file content at a location where we try to apply the hunk. (Previously, it represented a maximum [*Hamming* distance](https://en.wikipedia.org/wiki/Hamming_distance), meaning that a single insertion or deletion in the source file could stop a hunk from applying even with a high `fuzzFactor`.)
  * A hunk containing a deletion can now only be applied in a context where the line to be deleted actually appears verbatim. (Previously, as long as enough context lines in the hunk matched, `applyPatch` would apply the hunk anyway and delete a completely different line.)
  * The context line immediately before and immediately after an insertion must match exactly between the hunk and the file for a hunk to apply. (Previously this was not required.)
- [#535](https://github.com/kpdecker/jsdiff/pull/535) **A bug in patch generation functions is now fixed** that would sometimes previously cause `\ No newline at end of file` to appear in the wrong place in the generated patch, resulting in the patch being invalid. **These invalid patches can also no longer be applied successfully with `applyPatch`.** (It was already the case that tools other than jsdiff, like GNU `patch`, would consider them malformed and refuse to apply them; versions of jsdiff with this fix now do the same thing if you ask them to apply a malformed patch emitted by jsdiff v5.)
- [#535](https://github.com/kpdecker/jsdiff/pull/535) **Passing `newlineIsToken: true` to *patch*-generation functions is no longer allowed.** (Passing it to `diffLines` is still supported - it's only functions like `createPatch` where passing `newlineIsToken` is now an error.) Allowing it to be passed never really made sense, since in cases where the option had any effect on the output at all, the effect tended to be causing a garbled patch to be created that couldn't actually be applied to the source file.
- [#539](https://github.com/kpdecker/jsdiff/pull/539) **`diffWords` now takes an optional `intlSegmenter` option** which should be an `Intl.Segmenter` with word-level granularity. This provides better tokenization of text into words than the default behaviour, even for English but especially for some other languages for which the default behaviour is poor.

## v5.2.0

[Commits](https://github.com/kpdecker/jsdiff/compare/v5.1.0...v5.2.0)

- [#411](https://github.com/kpdecker/jsdiff/pull/411) Big performance improvement. Previously an O(n) array-copying operation inside the innermost loop of jsdiff's base diffing code increased the overall worst-case time complexity of computing a diff from O(n²) to O(n³). This is now fixed, bringing the worst-case time complexity down to what it theoretically should be for a Myers diff implementation.
- [#448](https://github.com/kpdecker/jsdiff/pull/448) Performance improvement. Diagonals whose furthest-reaching D-path would go off the edge of the edit graph are now skipped, rather than being pointlessly considered as called for by the original Myers diff algorithm. This dramatically speeds up computing diffs where the new text just appends or truncates content at the end of the old text.
- [#351](https://github.com/kpdecker/jsdiff/issues/351) Importing from the lib folder - e.g. `require("diff/lib/diff/word.js")` - will work again now. This had been broken for users on the latest version of Node since Node 17.5.0, which changed how Node interprets the `exports` property in jsdiff's `package.json` file.
- [#344](https://github.com/kpdecker/jsdiff/issues/344) `diffLines`, `createTwoFilesPatch`, and other patch-creation methods now take an optional `stripTrailingCr: true` option which causes Windows-style `\r\n` line endings to be replaced with Unix-style `\n` line endings before calculating the diff, just like GNU `diff`'s `--strip-trailing-cr` flag.
- [#451](https://github.com/kpdecker/jsdiff/pull/451) Added `diff.formatPatch`.
- [#450](https://github.com/kpdecker/jsdiff/pull/450) Added `diff.reversePatch`.
- [#478](https://github.com/kpdecker/jsdiff/pull/478) Added `timeout` option.

## v5.1.0

- [#365](https://github.com/kpdecker/jsdiff/issues/365) Allow early termination to limit execution time with degenerate cases

[Commits](https://github.com/kpdecker/jsdiff/compare/v5.0.0...v5.1.0)

## v5.0.0

- Breaking: UMD export renamed from `JsDiff` to `Diff`.
- Breaking: Newlines separated into separate tokens for word diff.
- Breaking: Unified diffs now match ["quirks"](https://www.artima.com/weblogs/viewpost.jsp?thread=164293)

[Commits](https://github.com/kpdecker/jsdiff/compare/v4.0.1...v5.0.0)

## v4.0.1 - January 6th, 2019

- Fix main reference path - b826104

[Commits](https://github.com/kpdecker/jsdiff/compare/v4.0.0...v4.0.1)

## v4.0.0 - January 5th, 2019

- [#94](https://github.com/kpdecker/jsdiff/issues/94) - Missing "No newline at end of file" when comparing two texts that do not end in newlines ([@federicotdn](https://api.github.com/users/federicotdn))
- [#227](https://github.com/kpdecker/jsdiff/issues/227) - Licence
- [#199](https://github.com/kpdecker/jsdiff/issues/199) - Import statement for jsdiff
- [#159](https://github.com/kpdecker/jsdiff/issues/159) - applyPatch affecting wrong line number with with new lines
- [#8](https://github.com/kpdecker/jsdiff/issues/8) - A new state "replace"
- Drop ie9 from karma targets - 79c31bd
- Upgrade deps. Convert from webpack to rollup - 2c1a29c
- Make ()[]"' as word boundaries between each other - f27b899
- jsdiff: Replaced phantomJS by chrome - ec3114e
- Add yarn.lock to .npmignore - 29466d8

Compatibility notes:

- Bower and Component packages no longer supported

[Commits](https://github.com/kpdecker/jsdiff/compare/v3.5.0...v4.0.0)

## v3.5.0 - March 4th, 2018

- Omit redundant slice in join method of diffArrays - 1023590
- Support patches with empty lines - fb0f208
- Accept a custom JSON replacer function for JSON diffing - 69c7f0a
- Optimize parch header parser - 2aec429
- Fix typos - e89c832

[Commits](https://github.com/kpdecker/jsdiff/compare/v3.4.0...v3.5.0)

## v3.4.0 - October 7th, 2017

- [#183](https://github.com/kpdecker/jsdiff/issues/183) - Feature request: ability to specify a custom equality checker for `diffArrays`
- [#173](https://github.com/kpdecker/jsdiff/issues/173) - Bug: diffArrays gives wrong result on array of booleans
- [#158](https://github.com/kpdecker/jsdiff/issues/158) - diffArrays will not compare the empty string in array?
- comparator for custom equality checks - 30e141e
- count oldLines and newLines when there are conflicts - 53bf384
- Fix: diffArrays can compare falsey items - 9e24284
- Docs: Replace grunt with npm test - 00e2f94

[Commits](https://github.com/kpdecker/jsdiff/compare/v3.3.1...v3.4.0)

## v3.3.1 - September 3rd, 2017

- [#141](https://github.com/kpdecker/jsdiff/issues/141) - Cannot apply patch because my file delimiter is "/r/n" instead of "/n"
- [#192](https://github.com/kpdecker/jsdiff/pull/192) - Fix: Bad merge when adding new files (#189)
- correct spelling mistake - 21fa478

[Commits](https://github.com/kpdecker/jsdiff/compare/v3.3.0...v3.3.1)

## v3.3.0 - July 5th, 2017

- [#114](https://github.com/kpdecker/jsdiff/issues/114) - /patch/merge not exported
- Gracefully accept invalid newStart in hunks, same as patch(1) does. - d8a3635
- Use regex rather than starts/ends with for parsePatch - 6cab62c
- Add browser flag - e64f674
- refactor: simplified code a bit more - 8f8e0f2
- refactor: simplified code a bit - b094a6f
- fix: some corrections re ignoreCase option - 3c78fd0
- ignoreCase option - 3cbfbb5
- Sanitize filename while parsing patches - 2fe8129
- Added better installation methods - aced50b
- Simple export of functionality - 8690f31

[Commits](https://github.com/kpdecker/jsdiff/compare/v3.2.0...v3.3.0)

## v3.2.0 - December 26th, 2016

- [#156](https://github.com/kpdecker/jsdiff/pull/156) - Add `undefinedReplacement` option to `diffJson` ([@ewnd9](https://api.github.com/users/ewnd9))
- [#154](https://github.com/kpdecker/jsdiff/pull/154) - Add `examples` and `images` to `.npmignore`. ([@wtgtybhertgeghgtwtg](https://api.github.com/users/wtgtybhertgeghgtwtg))
- [#153](https://github.com/kpdecker/jsdiff/pull/153) - feat(structuredPatch): Pass options to diffLines ([@Kiougar](https://api.github.com/users/Kiougar))

[Commits](https://github.com/kpdecker/jsdiff/compare/v3.1.0...v3.2.0)

## v3.1.0 - November 27th, 2016

- [#146](https://github.com/kpdecker/jsdiff/pull/146) - JsDiff.diffArrays to compare arrays ([@wvanderdeijl](https://api.github.com/users/wvanderdeijl))
- [#144](https://github.com/kpdecker/jsdiff/pull/144) - Split file using all possible line delimiter instead of hard-coded "/n" and join lines back using the original delimiters ([@soulbeing](https://api.github.com/users/soulbeing))

[Commits](https://github.com/kpdecker/jsdiff/compare/v3.0.1...v3.1.0)

## v3.0.1 - October 9th, 2016

- [#139](https://github.com/kpdecker/jsdiff/pull/139) - Make README.md look nicer in npmjs.com ([@takenspc](https://api.github.com/users/takenspc))
- [#135](https://github.com/kpdecker/jsdiff/issues/135) - parsePatch combines patches from multiple files into a single IUniDiff when there is no "Index" line ([@ramya-rao-a](https://api.github.com/users/ramya-rao-a))
- [#124](https://github.com/kpdecker/jsdiff/issues/124) - IE7/IE8 failure since 2.0.0 ([@boneskull](https://api.github.com/users/boneskull))

[Commits](https://github.com/kpdecker/jsdiff/compare/v3.0.0...v3.0.1)

## v3.0.0 - August 23rd, 2016

- [#130](https://github.com/kpdecker/jsdiff/pull/130) - Add callback argument to applyPatches `patched` option ([@piranna](https://api.github.com/users/piranna))
- [#120](https://github.com/kpdecker/jsdiff/pull/120) - Correctly handle file names containing spaces ([@adius](https://api.github.com/users/adius))
- [#119](https://github.com/kpdecker/jsdiff/pull/119) - Do single reflow ([@wifiextender](https://api.github.com/users/wifiextender))
- [#117](https://github.com/kpdecker/jsdiff/pull/117) - Make more usable with long strings. ([@abnbgist](https://api.github.com/users/abnbgist))

Compatibility notes:

- applyPatches patch callback now is async and requires the callback be called to continue operation

[Commits](https://github.com/kpdecker/jsdiff/compare/v2.2.3...v3.0.0)

## v2.2.3 - May 31st, 2016

- [#118](https://github.com/kpdecker/jsdiff/pull/118) - Add a fix for applying 0-length destination patches ([@chaaz](https://api.github.com/users/chaaz))
- [#115](https://github.com/kpdecker/jsdiff/pull/115) - Fixed grammar in README ([@krizalys](https://api.github.com/users/krizalys))
- [#113](https://github.com/kpdecker/jsdiff/pull/113) - fix typo ([@vmazare](https://api.github.com/users/vmazare))

[Commits](https://github.com/kpdecker/jsdiff/compare/v2.2.2...v2.2.3)

## v2.2.2 - March 13th, 2016

- [#102](https://github.com/kpdecker/jsdiff/issues/102) - diffJson with dates, returns empty curly braces ([@dr-dimitru](https://api.github.com/users/dr-dimitru))
- [#97](https://github.com/kpdecker/jsdiff/issues/97) - Whitespaces & diffWords ([@faiwer](https://api.github.com/users/faiwer))
- [#92](https://github.com/kpdecker/jsdiff/pull/92) - Fixes typo in the readme ([@bg451](https://api.github.com/users/bg451))

[Commits](https://github.com/kpdecker/jsdiff/compare/v2.2.1...v2.2.2)

## v2.2.1 - November 12th, 2015

- [#89](https://github.com/kpdecker/jsdiff/pull/89) - add in display selector to readme ([@FranDias](https://api.github.com/users/FranDias))
- [#88](https://github.com/kpdecker/jsdiff/pull/88) - Split diffs based on file headers instead of 'Index:' metadata ([@piranna](https://api.github.com/users/piranna))

[Commits](https://github.com/kpdecker/jsdiff/compare/v2.2.0...v2.2.1)

## v2.2.0 - October 29th, 2015

- [#80](https://github.com/kpdecker/jsdiff/pull/80) - Fix a typo: applyPath -> applyPatch ([@fluxxu](https://api.github.com/users/fluxxu))
- [#83](https://github.com/kpdecker/jsdiff/pull/83) - Add basic fuzzy matching to applyPatch ([@piranna](https://github.com/piranna))
  [Commits](https://github.com/kpdecker/jsdiff/compare/v2.2.0...v2.2.0)

## v2.2.0 - October 29th, 2015

- [#80](https://github.com/kpdecker/jsdiff/pull/80) - Fix a typo: applyPath -> applyPatch ([@fluxxu](https://api.github.com/users/fluxxu))
- [#83](https://github.com/kpdecker/jsdiff/pull/83) - Add basic fuzzy matching to applyPatch ([@piranna](https://github.com/piranna))
  [Commits](https://github.com/kpdecker/jsdiff/compare/v2.1.3...v2.2.0)

## v2.1.3 - September 30th, 2015

- [#78](https://github.com/kpdecker/jsdiff/pull/78) - fix: error throwing when apply patch to empty string ([@21paradox](https://api.github.com/users/21paradox))

[Commits](https://github.com/kpdecker/jsdiff/compare/v2.1.2...v2.1.3)

## v2.1.2 - September 23rd, 2015

- [#76](https://github.com/kpdecker/jsdiff/issues/76) - diff headers give error ([@piranna](https://api.github.com/users/piranna))

[Commits](https://github.com/kpdecker/jsdiff/compare/v2.1.1...v2.1.2)

## v2.1.1 - September 9th, 2015

- [#73](https://github.com/kpdecker/jsdiff/issues/73) - Is applyPatches() exposed in the API? ([@davidparsson](https://api.github.com/users/davidparsson))

[Commits](https://github.com/kpdecker/jsdiff/compare/v2.1.0...v2.1.1)

## v2.1.0 - August 27th, 2015

- [#72](https://github.com/kpdecker/jsdiff/issues/72) - Consider using options object API for flag permutations ([@kpdecker](https://api.github.com/users/kpdecker))
- [#70](https://github.com/kpdecker/jsdiff/issues/70) - diffWords treats \n at the end as significant whitespace ([@nesQuick](https://api.github.com/users/nesQuick))
- [#69](https://github.com/kpdecker/jsdiff/issues/69) - Missing count ([@wfalkwallace](https://api.github.com/users/wfalkwallace))
- [#68](https://github.com/kpdecker/jsdiff/issues/68) - diffLines seems broken ([@wfalkwallace](https://api.github.com/users/wfalkwallace))
- [#60](https://github.com/kpdecker/jsdiff/issues/60) - Support multiple diff hunks ([@piranna](https://api.github.com/users/piranna))
- [#54](https://github.com/kpdecker/jsdiff/issues/54) - Feature Request: 3-way merge ([@mog422](https://api.github.com/users/mog422))
- [#42](https://github.com/kpdecker/jsdiff/issues/42) - Fuzz factor for applyPatch ([@stuartpb](https://api.github.com/users/stuartpb))
- Move whitespace ignore out of equals method - 542063c
- Include source maps in babel output - 7f7ab21
- Merge diff/line and diff/patch implementations - 1597705
- Drop map utility method - 1ddc939
- Documentation for parsePatch and applyPatches - 27c4b77

Compatibility notes:

- The undocumented ignoreWhitespace flag has been removed from the Diff equality check directly. This implementation may be copied to diff utilities if dependencies existed on this functionality.

[Commits](https://github.com/kpdecker/jsdiff/compare/v2.0.2...v2.1.0)

## v2.0.2 - August 8th, 2015

- [#67](https://github.com/kpdecker/jsdiff/issues/67) - cannot require from npm module in node ([@commenthol](https://api.github.com/users/commenthol))
- Convert to chai since we don’t support IE8 - a96bbad

[Commits](https://github.com/kpdecker/jsdiff/compare/v2.0.1...v2.0.2)

## v2.0.1 - August 7th, 2015

- Add release build at proper step - 57542fd

[Commits](https://github.com/kpdecker/jsdiff/compare/v2.0.0...v2.0.1)

## v2.0.0 - August 7th, 2015

- [#66](https://github.com/kpdecker/jsdiff/issues/66) - Add karma and sauce tests ([@kpdecker](https://api.github.com/users/kpdecker))
- [#65](https://github.com/kpdecker/jsdiff/issues/65) - Create component repository for bower ([@kpdecker](https://api.github.com/users/kpdecker))
- [#64](https://github.com/kpdecker/jsdiff/issues/64) - Automatically call removeEmpty for all tokenizer calls ([@kpdecker](https://api.github.com/users/kpdecker))
- [#62](https://github.com/kpdecker/jsdiff/pull/62) - Allow access to structured object representation of patch data ([@bittrance](https://api.github.com/users/bittrance))
- [#61](https://github.com/kpdecker/jsdiff/pull/61) - Use svg instead of png to get better image quality ([@PeterDaveHello](https://api.github.com/users/PeterDaveHello))
- [#29](https://github.com/kpdecker/jsdiff/issues/29) - word tokenizer works only for 7 bit ascii ([@plasmagunman](https://api.github.com/users/plasmagunman))

Compatibility notes:

- `this.removeEmpty` is now called automatically for all instances. If this is not desired, this may be overridden on a per instance basis.
- The library has been refactored to use some ES6 features. The external APIs should remain the same, but bower projects that directly referenced the repository will now have to point to the [components/jsdiff](https://github.com/components/jsdiff) repository.

[Commits](https://github.com/kpdecker/jsdiff/compare/v1.4.0...v2.0.0)

## v1.4.0 - May 6th, 2015

- [#57](https://github.com/kpdecker/jsdiff/issues/57) - createPatch -> applyPatch failed. ([@mog422](https://api.github.com/users/mog422))
- [#56](https://github.com/kpdecker/jsdiff/pull/56) - Two files patch ([@rgeissert](https://api.github.com/users/rgeissert))
- [#14](https://github.com/kpdecker/jsdiff/issues/14) - Flip added and removed order? ([@jakesandlund](https://api.github.com/users/jakesandlund))

[Commits](https://github.com/kpdecker/jsdiff/compare/v1.3.2...v1.4.0)

## v1.3.2 - March 30th, 2015

- [#53](https://github.com/kpdecker/jsdiff/pull/53) - Updated README.MD with Bower installation instructions ([@ofbriggs](https://api.github.com/users/ofbriggs))
- [#49](https://github.com/kpdecker/jsdiff/issues/49) - Cannot read property 'oldlines' of undefined ([@nwtn](https://api.github.com/users/nwtn))
- [#44](https://github.com/kpdecker/jsdiff/issues/44) - invalid-meta jsdiff is missing "main" entry in bower.json

[Commits](https://github.com/kpdecker/jsdiff/compare/v1.3.1...v1.3.2)

## v1.3.1 - March 13th, 2015

- [#52](https://github.com/kpdecker/jsdiff/pull/52) - Fix for #51 Wrong result of JsDiff.diffLines ([@felicienfrancois](https://api.github.com/users/felicienfrancois))

[Commits](https://github.com/kpdecker/jsdiff/compare/v1.3.0...v1.3.1)

## v1.3.0 - March 2nd, 2015

- [#47](https://github.com/kpdecker/jsdiff/pull/47) - Adding Diff Trimmed Lines ([@JamesGould123](https://api.github.com/users/JamesGould123))

[Commits](https://github.com/kpdecker/jsdiff/compare/v1.2.2...v1.3.0)

## v1.2.2 - January 26th, 2015

- [#45](https://github.com/kpdecker/jsdiff/pull/45) - Fix AMD module loading ([@pedrocarrico](https://api.github.com/users/pedrocarrico))
- [#43](https://github.com/kpdecker/jsdiff/pull/43) - added a bower file ([@nbrustein](https://api.github.com/users/nbrustein))

[Commits](https://github.com/kpdecker/jsdiff/compare/v1.2.1...v1.2.2)

## v1.2.1 - December 26th, 2014

- [#41](https://github.com/kpdecker/jsdiff/pull/41) - change condition of using node export system. ([@ironhee](https://api.github.com/users/ironhee))

[Commits](https://github.com/kpdecker/jsdiff/compare/v1.2.0...v1.2.1)

## v1.2.0 - November 29th, 2014

- [#37](https://github.com/kpdecker/jsdiff/pull/37) - Add support for sentences. ([@vmariano](https://api.github.com/users/vmariano))
- [#28](https://github.com/kpdecker/jsdiff/pull/28) - Implemented diffJson ([@papandreou](https://api.github.com/users/papandreou))
- [#27](https://github.com/kpdecker/jsdiff/issues/27) - Slow to execute over diffs with a large number of changes ([@termi](https://api.github.com/users/termi))
- Allow for optional async diffing - 19385b9
- Fix diffChars implementation - eaa44ed

[Commits](https://github.com/kpdecker/jsdiff/compare/v1.1.0...v1.2.0)

## v1.1.0 - November 25th, 2014

- [#33](https://github.com/kpdecker/jsdiff/pull/33) - AMD and global exports ([@ovcharik](https://api.github.com/users/ovcharik))
- [#32](https://github.com/kpdecker/jsdiff/pull/32) - Add support for component ([@vmariano](https://api.github.com/users/vmariano))
- [#31](https://github.com/kpdecker/jsdiff/pull/31) - Don't rely on Array.prototype.map ([@papandreou](https://api.github.com/users/papandreou))

[Commits](https://github.com/kpdecker/jsdiff/compare/v1.0.8...v1.1.0)

## v1.0.8 - December 22nd, 2013

- [#24](https://github.com/kpdecker/jsdiff/pull/24) - Handle windows newlines on non windows machines. ([@benogle](https://api.github.com/users/benogle))
- [#23](https://github.com/kpdecker/jsdiff/pull/23) - Prettied up the API formatting a little, and added basic node and web examples ([@airportyh](https://api.github.com/users/airportyh))

[Commits](https://github.com/kpdecker/jsdiff/compare/v1.0.7...v1.0.8)

## v1.0.7 - September 11th, 2013

- [#22](https://github.com/kpdecker/jsdiff/pull/22) - Added variant of WordDiff that doesn't ignore whitespace differences ([@papandreou](https://api.github.com/users/papandreou)

- Add 0.10 to travis tests - 243a526

[Commits](https://github.com/kpdecker/jsdiff/compare/v1.0.6...v1.0.7)

## v1.0.6 - August 30th, 2013

- [#19](https://github.com/kpdecker/jsdiff/pull/19) - Explicitly define contents of npm package ([@sindresorhus](https://api.github.com/users/sindresorhus)

[Commits](https://github.com/kpdecker/jsdiff/compare/v1.0.5...v1.0.6)
