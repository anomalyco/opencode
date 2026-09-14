/*
 * Adapted from partial-json by the Promplate Dev Team:
 * https://github.com/promplate/partial-json-parser-js/blob/main/src/options.ts
 * Licensed under the MIT License; see partial-json.ts for the complete notice.
 */

/**
 * allow partial strings like `"hello \u12` to be parsed as `"hello `
 */
export const STR = 0b000000001

/**
 * allow partial numbers like `123.` to be parsed as `123`
 */
export const NUM = 0b000000010

/**
 * allow partial arrays like `[1, 2,` to be parsed as `[1, 2]`
 */
export const ARR = 0b000000100

/**
 * allow partial objects like `{"a": 1, "b":` to be parsed as `{"a": 1}`
 */
export const OBJ = 0b000001000

/**
 * allow `nu` to be parsed as `null`
 */
export const NULL = 0b000010000

/**
 * allow `tr` to be parsed as `true`, and `fa` to be parsed as `false`
 */
export const BOOL = 0b000100000

/**
 * allow `Na` to be parsed as `NaN`
 */
export const NAN = 0b001000000

/**
 * allow `Inf` to be parsed as `Infinity`
 */
export const INFINITY = 0b010000000

/**
 * allow `-Inf` to be parsed as `-Infinity`
 */
export const _INFINITY = 0b100000000

export const INF = INFINITY | _INFINITY
export const SPECIAL = NULL | BOOL | INF | NAN
export const ATOM = STR | NUM | SPECIAL
export const COLLECTION = ARR | OBJ
export const ALL = ATOM | COLLECTION

/**
 * Control what types you allow to be partially parsed.
 * The default is to allow all types to be partially parsed, which in most cases is the best option.
 */
export const Allow = { STR, NUM, ARR, OBJ, NULL, BOOL, NAN, INFINITY, _INFINITY, INF, SPECIAL, ATOM, COLLECTION, ALL }

export default Allow
