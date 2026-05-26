import { Option, Schema, SchemaGetter } from "effect"

export const AbsolutePath = Schema.String.pipe(Schema.brand("AbsolutePath"))
export type AbsolutePath = typeof AbsolutePath.Type

export const RelativePath = Schema.String.pipe(Schema.brand("RelativePath"))
export type RelativePath = typeof RelativePath.Type

/**
 * String input intended to flow to a filesystem operation (fopen, stat, etc.).
 *
 * Some open-weight models occasionally emit file paths wrapped in markdown
 * auto-links, e.g. `"[notes.md](http://notes.md)"`. This is post-training
 * chat distribution leaking through the tool boundary: the model has been
 * rewarded for auto-linking in conversational output and applies that prior
 * to fields where it makes no sense. Encoding the intent at the schema
 * level — "this string is going to fopen, not into a chat bubble" — plugs
 * the leak for every path field at once.
 *
 * Only the degenerate case (link text equals the URL with protocol stripped)
 * is rewritten. Real markdown like `[click](https://example.com)` passes
 * through untouched.
 *
 * Replaces `Schema.String` in tool parameter definitions for fields that
 * carry filesystem paths. The annotation lives on the encoded side so the
 * JSON Schema emitted to the LLM still carries the description.
 *
 *   filePath: FilePathInput({ description: "The absolute path to the file" })
 */
export const FilePathInput = (annotations?: { readonly description?: string }) => {
  const source = annotations?.description
    ? Schema.String.annotate({ description: annotations.description })
    : Schema.String
  return source.pipe(
    Schema.decodeTo(Schema.String, {
      decode: SchemaGetter.transform(unwrapDegenerateAutoLink),
      encode: SchemaGetter.passthrough({ strict: false }),
    }),
  )
}

function unwrapDegenerateAutoLink(input: string): string {
  // Two regexes — one for the whole-string case where the model emitted only
  // the auto-link, one for embedded auto-links within a longer path.
  const whole = input.match(/^\[([^\]]+)\]\((https?:\/\/)?([^)]+)\)$/)
  if (whole && whole[1] === whole[3]) return whole[1]
  return input.replace(/\[([^\]]+)\]\((https?:\/\/)?([^)]+)\)/g, (match, text, _proto, url) =>
    text === url ? text : match,
  )
}

/**
 * Integer greater than zero.
 */
export const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))

/**
 * Integer greater than or equal to zero.
 */
export const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

/**
 * Optional public JSON field that can hold explicit `undefined` on the type
 * side but encodes it as an omitted key, matching legacy `JSON.stringify`.
 */
export const optionalOmitUndefined = <S extends Schema.Top>(schema: S) =>
  Schema.optionalKey(schema).pipe(
    Schema.decodeTo(Schema.optional(schema), {
      decode: SchemaGetter.passthrough({ strict: false }),
      encode: SchemaGetter.transformOptional(Option.filter((value) => value !== undefined)),
    }),
  )

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
 * Attach static methods to a schema object. Designed to be used with `.pipe()`:
 *
 * @example
 *   export const Foo = fooSchema.pipe(
 *     withStatics((schema) => ({
 *       zero: schema.make(0),
 *       from: Schema.decodeUnknownOption(schema),
 *     }))
 *   )
 */
export const withStatics =
  <S extends object, M extends Record<string, unknown>>(methods: (schema: S) => M) =>
  (schema: S): S & M =>
    Object.assign(schema, methods(schema))

/**
 * Nominal wrapper for scalar types. The class itself is a valid schema —
 * pass it directly to `Schema.decode`, `Schema.decodeEffect`, etc.
 *
 * Overrides `~type.make` on the derived `Schema.Opaque` so `Schema.Schema.Type`
 * of a field using this newtype resolves to `Self` rather than the underlying
 * branded phantom. Without that override, passing a class instance to code
 * typed against `Schema.Schema.Type<FieldSchema>` would require a cast even
 * though the values are structurally equivalent at runtime.
 *
 * @example
 *   class QuestionID extends Newtype<QuestionID>()("QuestionID", Schema.String) {
 *     static make(id: string): QuestionID {
 *       return this.make(id)
 *     }
 *   }
 *
 *   Schema.decodeEffect(QuestionID)(input)
 */
export function Newtype<Self>() {
  return <const Tag extends string, S extends Schema.Top>(tag: Tag, schema: S) => {
    abstract class Base {
      declare readonly _newtype: Tag

      static make(value: Schema.Schema.Type<S>): Self {
        return value as unknown as Self
      }
    }

    Object.setPrototypeOf(Base, schema)

    return Base as unknown as (abstract new (_: never) => { readonly _newtype: Tag }) & {
      readonly make: (value: Schema.Schema.Type<S>) => Self
    } & Omit<Schema.Opaque<Self, S, {}>, "make" | "~type.make"> & {
        readonly "~type.make": Self
      }
  }
}
