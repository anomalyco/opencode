import type { JsonSchema } from "../../schema/index.js"
import { isRecord } from "../../utils/record.js"

// Gemini's `parametersJsonSchema` accepts standard JSON Schema, but rejects a few shapes that
// published tool schemas commonly contain. Rewrite only those and send everything else unchanged.
export const SCHEMA_MAPS = new Set([
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
  "dependencies",
])
export const VALUES = new Set(["const", "default", "enum", "examples", "dependentRequired"])

export const mapValues = (record: Record<string, unknown>, map: (value: unknown, key: string) => unknown) =>
  Object.fromEntries(Object.entries(record).map(([key, value]) => [key, map(value, key)]))

const valueType = (value: unknown): string | undefined => {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  if (typeof value === "string" || typeof value === "boolean") return typeof value
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number"
  if (isRecord(value)) return "object"
  return undefined
}

const enumGroups = (values: ReadonlyArray<unknown>): Array<[string, Array<unknown>]> | undefined => {
  const entries: Array<[string, unknown]> = []
  let hasInteger = false
  let hasNumber = false
  for (const value of values) {
    const type = valueType(value)
    if (type === undefined) return undefined
    if (type === "integer") hasInteger = true
    if (type === "number") hasNumber = true
    entries.push([type, value])
  }
  const grouped = new Map<string, Array<unknown>>()
  for (const [rawType, value] of entries) {
    // JSON Schema "number" subsumes "integer", so mixed ints and floats form one branch.
    const type = rawType === "integer" && hasInteger && hasNumber ? "number" : rawType
    const bucket = grouped.get(type)
    if (bucket) bucket.push(value)
    else grouped.set(type, [value])
  }
  return [...grouped.entries()]
}

const normalizeNode = (schema: unknown): unknown => {
  if (Array.isArray(schema)) return schema.map(normalizeNode)
  if (!isRecord(schema)) return schema
  const properties = isRecord(schema.properties) ? schema.properties : undefined
  // Gemini rejects enum/const schema nodes that omit `type`, and rejects `type` arrays across unrelated primitives.
  const groups =
    schema.type === undefined && Array.isArray(schema.enum) && schema.enum.length > 0
      ? enumGroups(schema.enum)
      : undefined
  const splitEnum = groups && groups.length > 1 ? groups.map(([type, values]) => ({ type, enum: values })) : undefined
  const inferredType =
    groups && groups.length === 1
      ? groups[0]![0]
      : schema.type === undefined && "const" in schema && !Array.isArray(schema.enum)
        ? valueType(schema.const)
        : undefined
  const mergeAnyOf = splitEnum !== undefined && "anyOf" in schema
  const entries: Array<[string, unknown]> = Object.entries(schema).flatMap(([key, value]) => {
    if (key === "enum" && splitEnum) return mergeAnyOf ? [] : [["anyOf", splitEnum]]
    if (key === "anyOf" && mergeAnyOf) return []
    if (key === "allOf" && mergeAnyOf) return []
    if (VALUES.has(key)) return [[key, value]]
    if (SCHEMA_MAPS.has(key) && isRecord(value)) return [[key, mapValues(value, normalizeNode)]]
    // `required` may only name declared properties.
    if (key === "required" && properties && Array.isArray(value))
      return [[key, value.filter((name) => typeof name === "string" && Object.hasOwn(properties, name))]]
    // Draft-04 boolean exclusive bounds become the numeric form.
    if (key === "exclusiveMinimum" && typeof value === "boolean")
      return value && typeof schema.minimum === "number" ? [[key, schema.minimum]] : []
    if (key === "exclusiveMaximum" && typeof value === "boolean")
      return value && typeof schema.maximum === "number" ? [[key, schema.maximum]] : []
    if (key === "minimum" && schema.exclusiveMinimum === true) return []
    if (key === "maximum" && schema.exclusiveMaximum === true) return []
    // Draft-07 tuples (`items` array plus `additionalItems`) are `prefixItems` plus `items` in 2020-12.
    if (key === "items" && Array.isArray(value)) return [["prefixItems", value.map(normalizeNode)]]
    if (key === "additionalItems" && Array.isArray(schema.items)) return [["items", normalizeNode(value)]]
    return [[key, normalizeNode(value)]]
  })
  if (mergeAnyOf) {
    const existingAllOf = Array.isArray(schema.allOf) ? (normalizeNode(schema.allOf) as Array<unknown>) : []
    entries.push(["allOf", [...existingAllOf, { anyOf: normalizeNode(schema.anyOf) }, { anyOf: splitEnum }]])
  }
  return Object.fromEntries([...(inferredType === undefined ? [] : [["type", inferredType]]), ...entries])
}

// Gemini accepts a recursive `$ref` only when the loop passes through an optional property or
// potentially empty array `items`. Replace other self-references with an unconstrained schema.
const cutLoops = (schema: unknown, target: string, safe: boolean): unknown => {
  if (Array.isArray(schema)) return schema.map((item) => cutLoops(item, target, safe))
  if (!isRecord(schema)) return schema
  if (schema.$ref === target && !safe) return {}
  const required = Array.isArray(schema.required) ? schema.required : []
  return mapValues(schema, (value, key) => {
    if (VALUES.has(key)) return value
    if (key === "items") return cutLoops(value, target, safe || !(Number(schema.minItems) > 0))
    if (key === "properties" && isRecord(value))
      return mapValues(value, (child, name) => cutLoops(child, target, safe || !required.includes(name)))
    if (SCHEMA_MAPS.has(key) && isRecord(value)) return mapValues(value, (child) => cutLoops(child, target, safe))
    return cutLoops(value, target, safe)
  })
}

export const normalize = (schema: JsonSchema): JsonSchema => {
  const normalized = normalizeNode(schema)
  if (!isRecord(normalized)) return {}
  const result = cutLoops(
    mapValues(normalized, (value, key) =>
      (key === "$defs" || key === "definitions") && isRecord(value)
        ? mapValues(value, (def, name) => cutLoops(def, `#/${key}/${name}`, false))
        : value,
    ),
    "#",
    false,
  )
  return isRecord(result) ? result : {}
}

export * as GeminiJsonSchema from "./gemini-json-schema.js"
