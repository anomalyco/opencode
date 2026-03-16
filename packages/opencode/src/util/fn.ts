import { z } from "zod"

/**
 * Creates a type-safe function wrapper with schema validation using zod.
 *
 * This utility wraps a callback function with runtime input validation.
 * If validation fails, it logs a stack trace and re-throws the error.
 * The returned function includes a `force` method for bypassing validation
 * and a `schema` property for accessing the validation schema.
 *
 * @param schema - Zod schema to validate input against
 * @param cb - Callback function that receives validated input
 * @returns A validated function with `force` and `schema` properties
 */
export function fn<T extends z.ZodType, Result>(schema: T, cb: (input: z.infer<T>) => Result) {
  const result = (input: z.infer<T>) => {
    let parsed
    try {
      parsed = schema.parse(input)
    } catch (e) {
      console.trace("schema validation failure stack trace:")
      throw e
    }

    return cb(parsed)
  }
  result.force = (input: z.infer<T>) => cb(input)
  result.schema = schema
  return result
}
