import { z } from "zod"

/**
 * Creates a type-safe function with Zod schema validation.
 *
 * Wraps a callback with automatic input validation using Zod schemas.
 * Provides a force method to bypass validation and exposes the schema.
 *
 * @param schema - The Zod schema to validate inputs against
 * @param cb - The callback function to execute with validated input
 * @returns A validated function with force method and schema property
 *
 * @example
 * ```typescript
 * const multiply = fn(z.number(), (n) => n * 2)
 * const result = multiply(5) // 10
 * const forced = multiply.force("5" as any) // Bypass validation
 * ```
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
