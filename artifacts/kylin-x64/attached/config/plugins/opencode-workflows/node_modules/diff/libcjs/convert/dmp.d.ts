import type { ChangeObject } from '../types.js';
type DmpOperation = 1 | 0 | -1;
/**
 * converts a list of change objects to the format returned by Google's [diff-match-patch](https://github.com/google/diff-match-patch) library
 */
export declare function convertChangesToDMP<ValueT>(changes: ChangeObject<ValueT>[]): [DmpOperation, ValueT][];
export {};
//# sourceMappingURL=dmp.d.ts.map