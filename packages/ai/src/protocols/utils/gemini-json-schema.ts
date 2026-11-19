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

/** JSON Schema type name for a scalar value. Returns undefined for non-scalars. */
const jsonType = (value: unknown): string | undefined => {
  if (typeof value === "string") return "string"
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number"
  if (typeof value === "boolean") return "boolean"
  if (typeof value === "object" && value !== null) return "object"
  return undefined
}

/** Groups enum values by their inferred JSON Schema type. */
const enumTypes = (values: ReadonlyArray<unknown>): Map<string, Array<unknown>> => {
  const groups = new Map<string, Array<unknown>>()
  for (const value of values) {
    const type = jsonType(value)
    if (type === undefined) continue
    const group = groups.get(type)
    if (group === undefined) groups.set(type, [value])
    else group.push(value)
  }
  return groups
}

/** When a schema node has `enum` or `const` but no `type`, infer `type` from the values.
 *
 * Gemini requires a `type` on every property. OpenCode's sanitizer previously preserved
 * `enum`/`const` unchanged, so enum-only schemas from MCP servers (e.g. browse's
 * `settings` tool with `enum`-only properties) failed every Gemini request with HTTP 400.
 *
 *   single-type enum   -> add `type` to match
 *   mixed-type enum    -> split into `anyOf` with one typed variant per type
 *   const              -> add `type` inferred from the const value
 *
 * Existing `type` is never overridden.
 */
const inferType = (schema: Record<string, unknown>): Record<string, unknown> => {
  if (schema.type !== undefined) return schema
  const enumValues = schema.enum
  if (Array.isArray(enumValues) && enumValues.length > 0) {
    const groups = enumTypes(enumValues)
    if (groups.size === 1) {
      const [type] = groups.keys()
      return { ...schema, type }
    }
    if (groups.size > 1) {
      const { enum: _enum, ...rest } = schema
      return {
        ...rest,
        anyOf: [...groups.entries()].map(([type, values]) => ({ type, enum: values })),
      }
    }
  }
  if (schema.const !== undefined) {
    const type = jsonType(schema.const)
    if (type !== undefined) return { ...schema, type }
  }
  return schema
}

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

/** Normalize every node in the schema: infer missing `type` from `enum`/`const` values. */
const normalizeAll = (schema: unknown): unknown => {
  const normalized = normalizeNode(schema)
  if (!isRecord(normalized)) return normalized
  const withInferredType = inferType(normalized)
  return Object.fromEntries(
    Object.entries(withInferredType).flatMap(([key, value]) => {
      if (VALUES.has(key)) return [[key, value]]
      if (SCHEMA_MAPS.has(key) && isRecord(value)) return [[key, mapValues(value, normalizeAll)]]
      return [[key, normalizeAll(value)]]
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
  const normalized = normalizeAll(schema)
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
