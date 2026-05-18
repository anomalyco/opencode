import { Schema } from "effect"
import z from "zod"
import { zod } from "@/util/effect-zod"

/**
 * Create a Schema-backed NamedError-shaped class.
 *
 * Drop-in replacement for `NamedError.create(tag, zodShape)` but backed by
 * `Schema.Struct` under the hood. The wire shape emitted by the derived
 * `.Schema` is still `{ name: tag, data: {...fields} }` so the generated
 * OpenAPI/SDK output is byte-identical to the original NamedError schema.
 *
 * Preserves the existing surface:
 *   - static `Schema` (Zod schema of the wire shape)
 *   - static `isInstance(x)`
 *   - instance `toObject()` returning `{ name, data }`
 *   - `new X({ ...data }, { cause })`
 */
export function namedSchemaError<Tag extends string, Fields extends Schema.Struct.Fields>(tag: Tag, fields: Fields) {
  // Wire shape matches the original NamedError output so the SDK stays stable.
  const dataSchema = Schema.Struct(fields)
  const wire = z
    .object({
      name: z.literal(tag),
      data: zod(dataSchema),
    })
    .meta({ ref: tag })

  // Effect Schema for the wire shape — used by HttpApi OpenAPI generation.
  const effectSchema = Schema.Struct({
    name: Schema.Literal(tag),
    data: dataSchema,
  }).annotate({ identifier: tag })

  type Data = Schema.Schema.Type<typeof dataSchema>

  class NamedSchemaError extends Error {
    static readonly Schema = wire
    static readonly EffectSchema = effectSchema
    static readonly tag = tag
    public static isInstance(input: unknown): input is NamedSchemaError {
      return typeof input === "object" && input !== null && "name" in input && (input as { name: unknown }).name === tag
    }

    public override readonly name: Tag = tag
    public readonly data: Data

    constructor(data: Data, options?: ErrorOptions) {
      super(tag, options)
      this.data = data
    }

    toObject(): { name: Tag; data: Data } {
      return { name: tag, data: this.data }
    }
  }

  Object.defineProperty(NamedSchemaError, "name", { value: tag })

  return NamedSchemaError
}
