import Diff from './base.js';
import type { ChangeObject, CallbackOptionAbortable, CallbackOptionNonabortable, DiffCallbackNonabortable, DiffLinesOptionsAbortable, DiffLinesOptionsNonabortable } from '../types.js';
declare class LineDiff extends Diff<string, string> {
    tokenize: typeof tokenize;
    equals(left: string, right: string, options: DiffLinesOptionsAbortable | DiffLinesOptionsNonabortable): boolean;
}
export declare const lineDiff: LineDiff;
/**
 * diffs two blocks of text, treating each line as a token.
 * @returns a list of change objects.
 */
export declare function diffLines(oldStr: string, newStr: string, options: DiffCallbackNonabortable<string>): undefined;
export declare function diffLines(oldStr: string, newStr: string, options: DiffLinesOptionsAbortable & CallbackOptionAbortable<string>): undefined;
export declare function diffLines(oldStr: string, newStr: string, options: DiffLinesOptionsNonabortable & CallbackOptionNonabortable<string>): undefined;
export declare function diffLines(oldStr: string, newStr: string, options: DiffLinesOptionsAbortable): ChangeObject<string>[] | undefined;
export declare function diffLines(oldStr: string, newStr: string, options?: DiffLinesOptionsNonabortable): ChangeObject<string>[];
export declare function diffTrimmedLines(oldStr: string, newStr: string, options: DiffCallbackNonabortable<string>): undefined;
export declare function diffTrimmedLines(oldStr: string, newStr: string, options: DiffLinesOptionsAbortable & CallbackOptionAbortable<string>): undefined;
export declare function diffTrimmedLines(oldStr: string, newStr: string, options: DiffLinesOptionsNonabortable & CallbackOptionNonabortable<string>): undefined;
export declare function diffTrimmedLines(oldStr: string, newStr: string, options: DiffLinesOptionsAbortable): ChangeObject<string>[] | undefined;
export declare function diffTrimmedLines(oldStr: string, newStr: string, options?: DiffLinesOptionsNonabortable): ChangeObject<string>[];
export declare function tokenize(value: string, options: DiffLinesOptionsAbortable | DiffLinesOptionsNonabortable): string[];
export {};
//# sourceMappingURL=line.d.ts.map