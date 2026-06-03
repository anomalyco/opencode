import Diff from './base.js';
import type { ChangeObject, CallbackOptionAbortable, CallbackOptionNonabortable, DiffCallbackNonabortable, DiffJsonOptionsAbortable, DiffJsonOptionsNonabortable } from '../types.js';
import { tokenize } from './line.js';
declare class JsonDiff extends Diff<string, string, string | object> {
    get useLongestToken(): boolean;
    tokenize: typeof tokenize;
    castInput(value: string | object, options: DiffJsonOptionsNonabortable | DiffJsonOptionsAbortable): string;
    equals(left: string, right: string, options: DiffJsonOptionsNonabortable | DiffJsonOptionsAbortable): boolean;
}
export declare const jsonDiff: JsonDiff;
/**
 * diffs two JSON-serializable objects by first serializing them to prettily-formatted JSON and then treating each line of the JSON as a token.
 * Object properties are ordered alphabetically in the serialized JSON, so the order of properties in the objects being compared doesn't affect the result.
 *
 * @returns a list of change objects.
 */
export declare function diffJson(oldStr: string | object, newStr: string | object, options: DiffCallbackNonabortable<string>): undefined;
export declare function diffJson(oldStr: string | object, newStr: string | object, options: DiffJsonOptionsAbortable & CallbackOptionAbortable<string>): undefined;
export declare function diffJson(oldStr: string | object, newStr: string | object, options: DiffJsonOptionsNonabortable & CallbackOptionNonabortable<string>): undefined;
export declare function diffJson(oldStr: string | object, newStr: string | object, options: DiffJsonOptionsAbortable): ChangeObject<string>[] | undefined;
export declare function diffJson(oldStr: string | object, newStr: string | object, options?: DiffJsonOptionsNonabortable): ChangeObject<string>[];
export declare function canonicalize(obj: any, stack: Array<any> | null, replacementStack: Array<any> | null, replacer: (k: string, v: any) => any, key?: string): any;
export {};
//# sourceMappingURL=json.d.ts.map