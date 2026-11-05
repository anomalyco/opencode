export interface ChangeObject<ValueT> {
    /**
     * The concatenated content of all the tokens represented by this change object - i.e. generally the text that is either added, deleted, or common, as a single string.
     * In cases where tokens are considered common but are non-identical (e.g. because an option like `ignoreCase` or a custom `comparator` was used), the value from the *new* string will be provided here.
     */
    value: ValueT;
    /**
     * true if the value was inserted into the new string, otherwise false
     */
    added: boolean;
    /**
     * true if the value was removed from the old string, otherwise false
     */
    removed: boolean;
    /**
     * How many tokens (e.g. chars for `diffChars`, lines for `diffLines`) the value in the change object consists of
     */
    count: number;
}
export type Change = ChangeObject<string>;
export type ArrayChange<T> = ChangeObject<T[]>;
export interface CommonDiffOptions {
    /**
     * If `true`, the array of change objects returned will contain one change object per token (e.g. one per line if calling `diffLines`), instead of runs of consecutive tokens that are all added / all removed / all conserved being combined into a single change object.
     */
    oneChangePerToken?: boolean;
}
export interface TimeoutOption {
    /**
     * A number of milliseconds after which the diffing algorithm will abort and return `undefined`.
     * Supported by the same functions as `maxEditLength`.
     */
    timeout: number;
}
export interface MaxEditLengthOption {
    /**
     * A number specifying the maximum edit distance to consider between the old and new texts.
     * You can use this to limit the computational cost of diffing large, very different texts by giving up early if the cost will be huge.
     * This option can be passed either to diffing functions (`diffLines`, `diffChars`, etc) or to patch-creation function (`structuredPatch`, `createPatch`, etc), all of which will indicate that the max edit length was reached by returning `undefined` instead of whatever they'd normally return.
     */
    maxEditLength: number;
}
export type AbortableDiffOptions = TimeoutOption | MaxEditLengthOption;
export type DiffCallbackNonabortable<T> = (result: ChangeObject<T>[]) => void;
export type DiffCallbackAbortable<T> = (result: ChangeObject<T>[] | undefined) => void;
export interface CallbackOptionNonabortable<T> {
    /**
     * If provided, the diff will be computed in async mode to avoid blocking the event loop while the diff is calculated.
     * The value of the `callback` option should be a function and will be passed the computed diff or patch as its first argument.
     */
    callback: DiffCallbackNonabortable<T>;
}
export interface CallbackOptionAbortable<T> {
    /**
     * If provided, the diff will be computed in async mode to avoid blocking the event loop while the diff is calculated.
     * The value of the `callback` option should be a function and will be passed the computed diff or patch as its first argument.
     */
    callback: DiffCallbackAbortable<T>;
}
interface DiffArraysOptions<T> extends CommonDiffOptions {
    comparator?: (a: T, b: T) => boolean;
}
export interface DiffArraysOptionsNonabortable<T> extends DiffArraysOptions<T> {
    /**
     * If provided, the diff will be computed in async mode to avoid blocking the event loop while the diff is calculated.
     * The value of the `callback` option should be a function and will be passed the computed diff or patch as its first argument.
     */
    callback?: DiffCallbackNonabortable<T[]>;
}
export type DiffArraysOptionsAbortable<T> = DiffArraysOptions<T> & AbortableDiffOptions & Partial<CallbackOptionAbortable<T[]>>;
interface DiffCharsOptions extends CommonDiffOptions {
    /**
     * If `true`, the uppercase and lowercase forms of a character are considered equal.
     * @default false
     */
    ignoreCase?: boolean;
}
export interface DiffCharsOptionsNonabortable extends DiffCharsOptions {
    /**
     * If provided, the diff will be computed in async mode to avoid blocking the event loop while the diff is calculated.
     * The value of the `callback` option should be a function and will be passed the computed diff or patch as its first argument.
     */
    callback?: DiffCallbackNonabortable<string>;
}
export type DiffCharsOptionsAbortable = DiffCharsOptions & AbortableDiffOptions & Partial<CallbackOptionAbortable<string>>;
interface DiffLinesOptions extends CommonDiffOptions {
    /**
     * `true` to remove all trailing CR (`\r`) characters before performing the diff.
     * This helps to get a useful diff when diffing UNIX text files against Windows text files.
     * @default false
     */
    stripTrailingCr?: boolean;
    /**
     * `true` to treat the newline character at the end of each line as its own token.
     * This allows for changes to the newline structure to occur independently of the line content and to be treated as such.
     * In general this is the more human friendly form of `diffLines`; the default behavior with this option turned off is better suited for patches and other computer friendly output.
     *
     * Note that while using `ignoreWhitespace` in combination with `newlineIsToken` is not an error, results may not be as expected.
     * With `ignoreWhitespace: true` and `newlineIsToken: false`, changing a completely empty line to contain some spaces is treated as a non-change, but with `ignoreWhitespace: true` and `newlineIsToken: true`, it is treated as an insertion.
     * This is because the content of a completely blank line is not a token at all in `newlineIsToken` mode.
     *
     * @default false
     */
    newlineIsToken?: boolean;
    /**
     * `true` to ignore a missing newline character at the end of the last line when comparing it to other lines.
     * (By default, the line `'b\n'` in text `'a\nb\nc'` is not considered equal to the line `'b'` in text `'a\nb'`; this option makes them be considered equal.)
     * Ignored if `ignoreWhitespace` or `newlineIsToken` are also true.
     * @default false
     */
    ignoreNewlineAtEof?: boolean;
    /**
     * `true` to ignore leading and trailing whitespace characters when checking if two lines are equal.
     * @default false
     */
    ignoreWhitespace?: boolean;
}
export interface DiffLinesOptionsNonabortable extends DiffLinesOptions {
    /**
     * If provided, the diff will be computed in async mode to avoid blocking the event loop while the diff is calculated.
     * The value of the `callback` option should be a function and will be passed the computed diff or patch as its first argument.
     */
    callback?: DiffCallbackNonabortable<string>;
}
export type DiffLinesOptionsAbortable = DiffLinesOptions & AbortableDiffOptions & Partial<CallbackOptionAbortable<string>>;
interface DiffWordsOptions extends CommonDiffOptions {
    /**
     * Same as in `diffChars`.
     * @default false
     */
    ignoreCase?: boolean;
    /**
     * An optional [`Intl.Segmenter`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter) object (which must have a `granularity` of `'word'`) for `diffWords` to use to split the text into words.
     *
     * Note that this is (deliberately) incorrectly typed as `any` to avoid users whose `lib` & `target` settings in tsconfig.json are older than es2022 getting type errors when they build about `Intl.Segmenter` not existing.
     * This is kind of ugly, since it makes the type declarations worse for users who genuinely use this feature, but seemed worth it to avoid the majority of the library's users (who probably do not use this particular option) getting confusing errors and being forced to change their `lib` to es2022 (even if their own code doesn't use any es2022 functions).
     *
     * By default, `diffWords` does not use an `Intl.Segmenter`, just some regexes for splitting text into words. This will tend to give worse results than `Intl.Segmenter` would, but ensures the results are consistent across environments; `Intl.Segmenter` behaviour is only loosely specced and the implementations in browsers could in principle change dramatically in future. If you want to use `diffWords` with an `Intl.Segmenter` but ensure it behaves the same whatever environment you run it in, use an `Intl.Segmenter` polyfill instead of the JavaScript engine's native `Intl.Segmenter` implementation.
     *
     * Using an `Intl.Segmenter` should allow better word-level diffing of non-English text than the default behaviour. For instance, `Intl.Segmenter`s can generally identify via built-in dictionaries which sequences of adjacent Chinese characters form words, allowing word-level diffing of Chinese. By specifying a language when instantiating the segmenter (e.g. `new Intl.Segmenter('sv', {granularity: 'word'})`) you can also support language-specific rules, like treating Swedish's colon separated contractions (like *k:a* for *kyrka*) as single words; by default this would be seen as two words separated by a colon.
     */
    intlSegmenter?: any;
}
export interface DiffWordsOptionsNonabortable extends DiffWordsOptions {
    /**
     * If provided, the diff will be computed in async mode to avoid blocking the event loop while the diff is calculated.
     * The value of the `callback` option should be a function and will be passed the computed diff or patch as its first argument.
     */
    callback?: DiffCallbackNonabortable<string>;
}
export type DiffWordsOptionsAbortable = DiffWordsOptions & AbortableDiffOptions & Partial<CallbackOptionAbortable<string>>;
interface DiffSentencesOptions extends CommonDiffOptions {
}
export interface DiffSentencesOptionsNonabortable extends DiffSentencesOptions {
    /**
     * If provided, the diff will be computed in async mode to avoid blocking the event loop while the diff is calculated.
     * The value of the `callback` option should be a function and will be passed the computed diff or patch as its first argument.
     */
    callback?: DiffCallbackNonabortable<string>;
}
export type DiffSentencesOptionsAbortable = DiffSentencesOptions & AbortableDiffOptions & Partial<CallbackOptionAbortable<string>>;
interface DiffJsonOptions extends CommonDiffOptions {
    /**
     * A value to replace `undefined` with. Ignored if a `stringifyReplacer` is provided.
     */
    undefinedReplacement?: any;
    /**
     * A custom replacer function.
     * Operates similarly to the `replacer` parameter to [`JSON.stringify()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify#the_replacer_parameter), but must be a function.
     */
    stringifyReplacer?: (k: string, v: any) => any;
}
export interface DiffJsonOptionsNonabortable extends DiffJsonOptions {
    /**
     * If provided, the diff will be computed in async mode to avoid blocking the event loop while the diff is calculated.
     * The value of the `callback` option should be a function and will be passed the computed diff or patch as its first argument.
     */
    callback?: DiffCallbackNonabortable<string>;
}
export type DiffJsonOptionsAbortable = DiffJsonOptions & AbortableDiffOptions & Partial<CallbackOptionAbortable<string>>;
interface DiffCssOptions extends CommonDiffOptions {
}
export interface DiffCssOptionsNonabortable extends DiffCssOptions {
    /**
     * If provided, the diff will be computed in async mode to avoid blocking the event loop while the diff is calculated.
     * The value of the `callback` option should be a function and will be passed the computed diff or patch as its first argument.
     */
    callback?: DiffCallbackNonabortable<string>;
}
export type DiffCssOptionsAbortable = DiffCssOptions & AbortableDiffOptions & Partial<CallbackOptionAbortable<string>>;
/**
 * Note that this contains the union of ALL options accepted by any of the built-in diffing
 * functions. The README notes which options are usable which functions. Using an option with a
 * diffing function that doesn't support it might yield unreasonable results.
 */
export type AllDiffOptions = DiffArraysOptions<unknown> & DiffCharsOptions & DiffWordsOptions & DiffLinesOptions & DiffJsonOptions;
export interface StructuredPatch {
    oldFileName: string | undefined;
    newFileName: string | undefined;
    oldHeader: string | undefined;
    newHeader: string | undefined;
    hunks: StructuredPatchHunk[];
    index?: string;
    /**
     * Set to true when the patch was parsed from a Git-style diff (one with a
     * `diff --git` header). Controls whether `formatPatch` emits a `diff --git`
     * header (instead of `Index:` / underline headers) when formatting the patch.
     */
    isGit?: boolean;
    /**
     * Set to true when parsing a Git diff that includes `rename from`/`rename to`
     * extended headers, indicating the file was renamed (and the old file no
     * longer exists). Consumers applying the patch should delete the old file.
     */
    isRename?: boolean;
    /**
     * Set to true when parsing a Git diff that includes `copy from`/`copy to`
     * extended headers, indicating the file was copied (and the old file still
     * exists). Consumers applying the patch should NOT delete the old file.
     */
    isCopy?: boolean;
    /**
     * Set to true when parsing a Git diff that includes a `new file mode` extended
     * header, indicating the file was newly created.
     */
    isCreate?: boolean;
    /**
     * Set to true when parsing a Git diff that includes a `deleted file mode`
     * extended header, indicating the file was deleted.
     */
    isDelete?: boolean;
    /**
     * The file mode (e.g. `'100644'`, `'100755'`) of the old file, parsed from
     * Git extended headers (`old mode` or `deleted file mode`).
     */
    oldMode?: string;
    /**
     * The file mode (e.g. `'100644'`, `'100755'`) of the new file, parsed from
     * Git extended headers (`new mode` or `new file mode`).
     */
    newMode?: string;
    /**
     * Set to true when parsing a Git diff that includes a
     * `Binary files ... differ` line, indicating a binary file change.
     * Binary patches have no hunks, so the patch content alone is not
     * sufficient to apply the change; consumers should handle this case
     * specially (e.g. by warning the user or fetching the binary content
     * separately).
     */
    isBinary?: boolean;
}
export interface StructuredPatchHunk {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: string[];
}
export {};
//# sourceMappingURL=types.d.ts.map