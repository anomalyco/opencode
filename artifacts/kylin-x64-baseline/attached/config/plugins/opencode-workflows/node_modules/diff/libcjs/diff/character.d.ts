import Diff from './base.js';
import type { ChangeObject, CallbackOptionAbortable, CallbackOptionNonabortable, DiffCallbackNonabortable, DiffCharsOptionsAbortable, DiffCharsOptionsNonabortable } from '../types.js';
declare class CharacterDiff extends Diff<string, string> {
}
export declare const characterDiff: CharacterDiff;
/**
 * diffs two blocks of text, treating each character as a token.
 *
 * ("Characters" here means Unicode code points - the elements you get when you loop over a string with a `for ... of ...` loop.)
 *
 * @returns a list of change objects.
 */
export declare function diffChars(oldStr: string, newStr: string, options: DiffCallbackNonabortable<string>): undefined;
export declare function diffChars(oldStr: string, newStr: string, options: DiffCharsOptionsAbortable & CallbackOptionAbortable<string>): undefined;
export declare function diffChars(oldStr: string, newStr: string, options: DiffCharsOptionsNonabortable & CallbackOptionNonabortable<string>): undefined;
export declare function diffChars(oldStr: string, newStr: string, options: DiffCharsOptionsAbortable): ChangeObject<string>[] | undefined;
export declare function diffChars(oldStr: string, newStr: string, options?: DiffCharsOptionsNonabortable): ChangeObject<string>[];
export {};
//# sourceMappingURL=character.d.ts.map