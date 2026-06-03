import Diff from './base.js';
import type { ChangeObject, DiffArraysOptionsNonabortable, CallbackOptionNonabortable, DiffArraysOptionsAbortable, DiffCallbackNonabortable, CallbackOptionAbortable } from '../types.js';
declare class ArrayDiff<T> extends Diff<T, Array<T>> {
    tokenize(value: Array<T>): T[];
    join(value: Array<T>): T[];
    removeEmpty(value: Array<T>): T[];
}
export declare const arrayDiff: ArrayDiff<unknown>;
/**
 * diffs two arrays of tokens, comparing each item for strict equality (===).
 * @returns a list of change objects.
 */
export declare function diffArrays<T>(oldArr: T[], newArr: T[], options: DiffCallbackNonabortable<T[]>): undefined;
export declare function diffArrays<T>(oldArr: T[], newArr: T[], options: DiffArraysOptionsAbortable<T> & CallbackOptionAbortable<T[]>): undefined;
export declare function diffArrays<T>(oldArr: T[], newArr: T[], options: DiffArraysOptionsNonabortable<T> & CallbackOptionNonabortable<T[]>): undefined;
export declare function diffArrays<T>(oldArr: T[], newArr: T[], options: DiffArraysOptionsAbortable<T>): ChangeObject<T[]>[] | undefined;
export declare function diffArrays<T>(oldArr: T[], newArr: T[], options?: DiffArraysOptionsNonabortable<T>): ChangeObject<T[]>[];
export {};
//# sourceMappingURL=array.d.ts.map