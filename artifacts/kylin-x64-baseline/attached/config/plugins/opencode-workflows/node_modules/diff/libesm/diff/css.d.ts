import Diff from './base.js';
import type { ChangeObject, CallbackOptionAbortable, CallbackOptionNonabortable, DiffCallbackNonabortable, DiffCssOptionsAbortable, DiffCssOptionsNonabortable } from '../types.js';
declare class CssDiff extends Diff<string, string> {
    tokenize(value: string): string[];
}
export declare const cssDiff: CssDiff;
/**
 * diffs two blocks of text, comparing CSS tokens.
 *
 * @returns a list of change objects.
 */
export declare function diffCss(oldStr: string, newStr: string, options: DiffCallbackNonabortable<string>): undefined;
export declare function diffCss(oldStr: string, newStr: string, options: DiffCssOptionsAbortable & CallbackOptionAbortable<string>): undefined;
export declare function diffCss(oldStr: string, newStr: string, options: DiffCssOptionsNonabortable & CallbackOptionNonabortable<string>): undefined;
export declare function diffCss(oldStr: string, newStr: string, options: DiffCssOptionsAbortable): ChangeObject<string>[] | undefined;
export declare function diffCss(oldStr: string, newStr: string, options?: DiffCssOptionsNonabortable): ChangeObject<string>[];
export {};
//# sourceMappingURL=css.d.ts.map