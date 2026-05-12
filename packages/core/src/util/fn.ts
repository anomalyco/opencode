type Parsed<T> = T extends {
  readonly "~standard": {
    readonly types?: {
      readonly output: infer Output
    }
  }
}
  ? Output
  : never

export function fn<
  T extends {
    readonly "~standard": {
      readonly types?: {
        readonly output: unknown
      }
    }
    parse(input: unknown): Parsed<T>
  },
  Result,
>(schema: T, cb: (input: Parsed<T>) => Result) {
  const result = (input: Parsed<T>) => {
    const parsed = schema.parse(input)
    return cb(parsed)
  }
  result.force = (input: Parsed<T>) => cb(input)
  result.schema = schema
  return result
}
