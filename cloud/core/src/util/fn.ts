import { z } from "zod"

export function fn<T extends z.ZodType, Result>(
  schema: T,
  cb: (input: z.output<T>) => Result,
) {
  const result = (input: z.input<T>) => {
    const parsed = schema.parse(input)
    return cb(parsed)
  }
  result.force = (input: z.input<T>) => cb(input)
  result.schema = schema
  return result
}
