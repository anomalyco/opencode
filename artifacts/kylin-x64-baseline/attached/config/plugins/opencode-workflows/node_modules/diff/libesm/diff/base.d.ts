import type { ChangeObject, AllDiffOptions, AbortableDiffOptions, DiffCallbackNonabortable, CallbackOptionAbortable, CallbackOptionNonabortable } from '../types.js';
export default class Diff<TokenT, ValueT extends Iterable<TokenT> = Iterable<TokenT>, InputValueT = ValueT> {
    diff(oldStr: InputValueT, newStr: InputValueT, options: DiffCallbackNonabortable<ValueT>): undefined;
    diff(oldStr: InputValueT, newStr: InputValueT, options: AllDiffOptions & AbortableDiffOptions & CallbackOptionAbortable<ValueT>): undefined;
    diff(oldStr: InputValueT, newStr: InputValueT, options: AllDiffOptions & CallbackOptionNonabortable<ValueT>): undefined;
    diff(oldStr: InputValueT, newStr: InputValueT, options: AllDiffOptions & AbortableDiffOptions): ChangeObject<ValueT>[] | undefined;
    diff(oldStr: InputValueT, newStr: InputValueT, options?: AllDiffOptions): ChangeObject<ValueT>[];
    private diffWithOptionsObj;
    private addToPath;
    private extractCommon;
    equals(left: TokenT, right: TokenT, options: AllDiffOptions): boolean;
    removeEmpty(array: TokenT[]): TokenT[];
    castInput(value: InputValueT, options: AllDiffOptions): ValueT;
    tokenize(value: ValueT, options: AllDiffOptions): TokenT[];
    join(chars: TokenT[]): ValueT;
    postProcess(changeObjects: ChangeObject<ValueT>[], options: AllDiffOptions): ChangeObject<ValueT>[];
    get useLongestToken(): boolean;
    private buildValues;
}
//# sourceMappingURL=base.d.ts.map