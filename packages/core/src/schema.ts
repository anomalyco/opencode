import { Schema } from "effect"
import {
  AbsolutePath,
  DateTimeUtcFromMillis,
  NonNegativeInt,
  optional,
  PositiveInt,
  RelativePath,
  statics,
} from "@opencode-ai/schema/schema"

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

/**
 * Nominal wrapper for scalar types. The class itself is a valid schema —
 * pass it directly to `Schema.decode`, `Schema.decodeEffect`, etc.
 *
 * The runtime value remains an unwrapped primitive. `Schema.brand` supplies
 * the primitive schema behavior and constructor validation, while the class
 * supplies the nominal TypeScript identity.
 * Apply checks and annotations to the underlying schema before wrapping it;
 * schema rebuild operations intentionally return the underlying schema shape.
 *
 * @example
 *   class QuestionID extends Newtype<QuestionID>()("QuestionID", Schema.String) {}
 *
 *   const id = QuestionID.make("question-1")
 *   Schema.decodeUnknownEffect(QuestionID)(input)
 */
type NewtypeSchema<Self, Tag extends string, S extends Schema.Top> = (abstract new (_: never) => {
  readonly _newtype: Tag
}) &
  Schema.Bottom<
    Self,
    S["Encoded"],
    S["DecodingServices"],
    S["EncodingServices"],
    S["ast"],
    S["Rebuild"],
    S["~type.make.in"],
    Self,
    S["~type.parameters"],
    Self,
    S["~type.mutability"],
    S["~type.optionality"],
    S["~type.constructor.default"],
    S["~encoded.mutability"],
    S["~encoded.optionality"]
  > &
  Omit<S, keyof Schema.Top>

export function Newtype<Self>() {
  return <const Tag extends string, S extends Schema.Top>(tag: Tag, schema: S): NewtypeSchema<Self, Tag, S> => {
    abstract class Base {
      declare readonly _newtype: Tag
    }

    Object.setPrototypeOf(Base, schema.pipe(Schema.brand(tag)))
    return Base as unknown as NewtypeSchema<Self, Tag, S>
  }
}
