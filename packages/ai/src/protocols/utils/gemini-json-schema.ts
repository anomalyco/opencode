import type { JsonSchema } from "../../schema/index.js"
import { isRecord } from "../../utils/record.js"

// Gemini's `parametersJsonSchema` accepts standard JSON Schema, but rejects a few shapes that
// published tool schemas commonly contain. Rewrite only those and send everything else unchanged.
const SCHEMA_MAPS = new Set([
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
  "dependencies",
])
const VALUES = new Set(["const", "default", "enum", "examples", "dependentRequired"])

const mapValues = (record: Record<string, unknown>, map: (value: unknown, key: string) => unknown) =>
  Object.fromEntries(Object.entries(record).map(([key, value]) => [key, map(value, key)]))

const normalizeNode = (schema: unknown): unknown => {
  if (Array.isArray(schema)) return schema.map(normalizeNode)
  if (!isRecord(schema)) return schema
  const properties = isRecord(schema.properties) ? schema.properties : undefined
  return Object.fromEntries(
    Object.entries(schema).flatMap(([key, value]) => {
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
    }),
  )
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
