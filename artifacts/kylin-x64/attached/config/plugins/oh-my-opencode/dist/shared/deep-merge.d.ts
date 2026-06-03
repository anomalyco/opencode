export declare function isPlainObject(value: unknown): value is Record<string, unknown>;
/**
 * Deep merges two objects, with override values taking precedence.
 * - Objects are recursively merged
 * - Arrays are replaced (not concatenated)
 * - undefined values in override do not overwrite base values
 *
 * @example
 * deepMerge({ a: 1, b: { c: 2, d: 3 } }, { b: { c: 10 }, e: 5 })
 * // => { a: 1, b: { c: 10, d: 3 }, e: 5 }
 */
export declare function deepMerge<T extends Record<string, unknown>>(base: T, override: Partial<T>, depth?: number): T;
export declare function deepMerge<T extends Record<string, unknown>>(base: T | undefined, override: T | undefined, depth?: number): T | undefined;
