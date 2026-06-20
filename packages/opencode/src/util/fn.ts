import type { z } from "zod"

export function fn<Schema extends z.ZodType, Result>(schema: Schema, handler: (input: z.output<Schema>) => Result) {
  return (input: z.input<Schema>): Result => handler(schema.parse(input))
}
