import { Schema } from "effect"
import { NamedError } from "@opencode-ai/core/util/error"

/**
 * Create a Schema-backed NamedError-shaped class.
 */
export function namedSchemaError<Tag extends string, Fields extends Schema.Struct.Fields>(tag: Tag, fields: Fields) {
  return NamedError.create(tag, fields)
}
