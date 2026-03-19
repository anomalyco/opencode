import { z } from "zod"

/**
 * Wraps a function with Zod schema validation for its input.
 *
 * This utility ensures type safety at runtime by validating inputs
 * against a Zod schema before executing the callback function.
 *
 * @example
 * ```typescript
 * const add = fn(z.object({ a: z.number(), b: z.number() }), ({ a, b }) => a + b)
 * add({ a: 1, b: 2 }) // returns 3
 * add({ a: 1 }) // throws ZodError - b is required
 * ```
 *
 * @param schema - Zod schema to validate inputs against
 * @param cb - Callback function that receives validated input
 * @returns A wrapped function with schema validation
 */
export function fn<T extends z.ZodType, Result>(schema: T, cb: (input: z.infer<T>) => Result) {
  const result = (input: z.infer<T>) => {
    let parsed
    try {
      parsed = schema.parse(input)
    } catch (e) {
      console.trace("schema validation failure stack trace:")
      if (e instanceof z.ZodError) {
        console.error("schema validation issues:", JSON.stringify(e.issues, null, 2))
      }
      throw e
    }

    return cb(parsed)
  }
  /** Skip validation and force execution with raw input (use with caution) */
  result.force = (input: z.infer<T>) => cb(input)
  /** The Zod schema used for validation */
  result.schema = schema
  return result
}
