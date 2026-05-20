/**
 * JSON-friendly union that mirrors what Pinia Colada can hash.
 */
export type JsonValue = null | string | number | boolean | JsonValue[] | {
    [key: string]: JsonValue;
};
/**
 * Replacer that converts non-JSON values (bigint, Date, etc.) to safe substitutes.
 */
export declare const queryKeyJsonReplacer: (_key: string, value: unknown) => {} | null | undefined;
/**
 * Safely stringifies a value and parses it back into a JsonValue.
 */
export declare const stringifyToJsonValue: (input: unknown) => JsonValue | undefined;
/**
 * Normalizes any accepted value into a JSON-friendly shape for query keys.
 */
export declare const serializeQueryKeyValue: (value: unknown) => JsonValue | undefined;
