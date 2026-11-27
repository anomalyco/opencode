export type JSONSchemaType = "string" | "number" | "integer" | "boolean" | "object" | "array" | "null"

/**
 * The JSON Schema (draft 2020-12) subset widget templates declare their data with. Other keywords are allowed and ignored by
 * `validateData`; `$ref` is not supported.
 */
export interface JSONSchema {
  readonly type?: JSONSchemaType | ReadonlyArray<JSONSchemaType>
  readonly description?: string
  readonly properties?: { readonly [key: string]: JSONSchema }
  readonly required?: ReadonlyArray<string>
  readonly additionalProperties?: boolean | JSONSchema
  readonly items?: JSONSchema
  readonly minItems?: number
  readonly maxItems?: number
  readonly minLength?: number
  readonly maxLength?: number
  /** An ECMAScript regular expression (with the `u` flag) a string must match somewhere. */
  readonly pattern?: string
  readonly minimum?: number
  readonly maximum?: number
  readonly enum?: ReadonlyArray<unknown>
  readonly const?: unknown
  readonly oneOf?: ReadonlyArray<JSONSchema>
  readonly anyOf?: ReadonlyArray<JSONSchema>
  readonly [keyword: string]: unknown
}

/** Problems with `data` against `schema`, as `<JSON pointer>: <message>`; empty when it is valid. */
export function validateData(schema: JSONSchema, data: unknown): string[] {
  return check(schema, data, "")
}

function check(schema: JSONSchema, value: unknown, path: string): string[] {
  const at = path || "/"
  if (schema.const !== undefined && !equal(schema.const, value))
    return [`${at}: must be ${JSON.stringify(schema.const)}`]
  if (schema.enum && !schema.enum.some((item) => equal(item, value)))
    return [`${at}: must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(", ")}`]
  const types = schema.type === undefined ? undefined : [schema.type].flat()
  if (types && !types.some((type) => is(type, value))) return [`${at}: must be ${types.join(" or ")}`]
  if (typeof value === "string" && schema.pattern !== undefined) {
    const problem = pattern(schema.pattern, value)
    if (problem) return [`${at}: ${problem}`]
  }
  return [
    ...alternatives(schema, value, path),
    ...range(at, size(schema, value)),
    ...(Array.isArray(value) ? value.flatMap((item, index) => items(schema, item, `${path}/${index}`)) : []),
    ...(isObject(value) ? properties(schema, value, path) : []),
  ]
}

function alternatives(schema: JSONSchema, value: unknown, path: string) {
  const at = path || "/"
  if (schema.anyOf) {
    const results = schema.anyOf.map((option) => check(option, value, path))
    if (!results.some((errors) => errors.length === 0)) return closest(results)
  }
  if (schema.oneOf) {
    const results = schema.oneOf.map((option) => check(option, value, path))
    const matches = results.filter((errors) => errors.length === 0).length
    if (matches === 0) return closest(results)
    if (matches > 1) return [`${at}: must match exactly one schema in oneOf, matches ${matches}`]
  }
  return []
}

// The errors of the alternative that came closest, which usually names what the author meant.
function closest(results: string[][]) {
  return results.reduce((best, errors) => (errors.length < best.length ? errors : best))
}

function size(schema: JSONSchema, value: unknown) {
  if (typeof value === "number")
    return { measure: value, min: schema.minimum, max: schema.maximum, unit: "", verb: "be" }
  if (typeof value === "string")
    return { measure: value.length, min: schema.minLength, max: schema.maxLength, unit: " characters", verb: "have" }
  if (Array.isArray(value))
    return { measure: value.length, min: schema.minItems, max: schema.maxItems, unit: " items", verb: "have" }
  return undefined
}

function range(at: string, limit: ReturnType<typeof size>) {
  if (!limit) return []
  if (limit.min !== undefined && limit.measure < limit.min)
    return [`${at}: must ${limit.verb} at least ${limit.min}${limit.unit}`]
  if (limit.max !== undefined && limit.measure > limit.max)
    return [`${at}: must ${limit.verb} at most ${limit.max}${limit.unit}`]
  return []
}

function items(schema: JSONSchema, item: unknown, path: string) {
  if (!schema.items) return []
  return check(schema.items, item, path)
}

function properties(schema: JSONSchema, value: Record<string, unknown>, path: string) {
  const known = schema.properties ?? {}
  const extra = schema.additionalProperties
  return [
    ...(schema.required ?? []).filter((key) => value[key] === undefined).map((key) => `${path}/${key}: is required`),
    ...Object.entries(value).flatMap(([key, item]) => {
      if (item === undefined) return []
      if (known[key]) return check(known[key], item, `${path}/${key}`)
      if (extra === false) return [`${path}/${key}: is not allowed`]
      if (extra === undefined || extra === true) return []
      return check(extra, item, `${path}/${key}`)
    }),
  ]
}

// Schemas come from models, so a pattern that is not a valid regular expression is reported rather than thrown.
function pattern(source: string, value: string) {
  try {
    return new RegExp(source, "u").test(value) ? undefined : `must match ${source}`
  } catch {
    return `has an invalid pattern ${source}`
  }
}

function is(type: JSONSchemaType, value: unknown) {
  if (type === "integer") return Number.isInteger(value)
  if (type === "number") return typeof value === "number" && Number.isFinite(value)
  if (type === "null") return value === null
  if (type === "array") return Array.isArray(value)
  if (type === "object") return isObject(value)
  return typeof value === type
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function equal(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b)
}
