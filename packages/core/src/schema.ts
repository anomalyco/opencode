import {
  AbsolutePath,
  DateTimeUtcFromMillis,
  NonNegativeInt,
  optional,
  PositiveInt,
  RelativePath,
  statics,
} from "@opencode/schema/schema"

export { AbsolutePath, DateTimeUtcFromMillis, NonNegativeInt, optional, PositiveInt, RelativePath, statics }

/**
 * Strip `readonly` from a nested type. Stand-in for `effect`'s `Types.DeepMutable`
 * until `effect:core/x228my` ("Types.DeepMutable widens unknown to `{}`") lands.
 *
 * The upstream version falls through `unknown` into `{ -readonly [K in keyof T]: ... }`
 * where `keyof unknown = never`, so `unknown` collapses to `{}`. This local
 * version gates the object branch on `extends object` (which `unknown` does
 * not) so `unknown` passes through untouched.
 *
 * Primitive bailout matches upstream — without it, branded strings like
 * `string & Brand<"SessionID">` fall into the object branch and get their
 * prototype methods walked.
 *
 * Tuple branch preserves readonly tuples (e.g. `ConfigPlugin.Spec`'s
 * `readonly [string, Options]`); the general array branch would otherwise
 * widen them to unbounded arrays.
 */
// eslint-disable-next-line @typescript-eslint/ban-types
export type DeepMutable<T> = T extends string | number | boolean | bigint | symbol | Function
  ? T
  : T extends readonly [unknown, ...unknown[]]
    ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
    : T extends readonly (infer U)[]
      ? DeepMutable<U>[]
      : T extends object
        ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
        : T
