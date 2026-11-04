import Diff from './base.js';
import type { ChangeObject, CallbackOptionAbortable, CallbackOptionNonabortable, DiffCallbackNonabortable, DiffWordsOptionsAbortable, DiffWordsOptionsNonabortable } from '../types.js';
declare class WordDiff extends Diff<string, string> {
    equals(left: string, right: string, options: DiffWordsOptionsAbortable | DiffWordsOptionsNonabortable): boolean;
    tokenize(value: string, options?: DiffWordsOptionsAbortable | DiffWordsOptionsNonabortable): string[];
    join(tokens: string[]): string;
    postProcess(changes: ChangeObject<string>[], options: any): ChangeObject<string>[];
}
export declare const wordDiff: WordDiff;
/**
 * diffs two blocks of text, treating each word and each punctuation mark as a token.
 * Whitespace is ignored when computing the diff (but preserved as far as possible in the final change objects).
 *
 * @returns a list of change objects.
 */
export declare function diffWords(oldStr: string, newStr: string, options: DiffCallbackNonabortable<string>): undefined;
export declare function diffWords(oldStr: string, newStr: string, options: DiffWordsOptionsAbortable & CallbackOptionAbortable<string>): undefined;
export declare function diffWords(oldStr: string, newStr: string, options: DiffWordsOptionsNonabortable & CallbackOptionNonabortable<string>): undefined;
export declare function diffWords(oldStr: string, newStr: string, options: DiffWordsOptionsAbortable): ChangeObject<string>[] | undefined;
export declare function diffWords(oldStr: string, newStr: string, options?: DiffWordsOptionsNonabortable): ChangeObject<string>[];
declare class WordsWithSpaceDiff extends Diff<string, string> {
    tokenize(value: string): [] | RegExpMatchArray;
}
export declare const wordsWithSpaceDiff: WordsWithSpaceDiff;
/**
 * diffs two blocks of text, treating each word, punctuation mark, newline, or run of (non-newline) whitespace as a token.
 * @returns a list of change objects
 */
export declare function diffWordsWithSpace(oldStr: string, newStr: string, options: DiffCallbackNonabortable<string>): undefined;
export declare function diffWordsWithSpace(oldStr: string, newStr: string, options: DiffWordsOptionsAbortable & CallbackOptionAbortable<string>): undefined;
export declare function diffWordsWithSpace(oldStr: string, newStr: string, options: DiffWordsOptionsNonabortable & CallbackOptionNonabortable<string>): undefined;
export declare function diffWordsWithSpace(oldStr: string, newStr: string, options: DiffWordsOptionsAbortable): ChangeObject<string>[] | undefined;
export declare function diffWordsWithSpace(oldStr: string, newStr: string, options?: DiffWordsOptionsNonabortable): ChangeObject<string>[];
export {};
//# sourceMappingURL=word.d.ts.map