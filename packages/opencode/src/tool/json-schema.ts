import type { JSONSchema7 } from "@ai-sdk/provider"
import { JsonSchema, Schema } from "effect"
import type * as Tool from "./tool"

type JsonObject = Record<string, unknown>
const cache = new WeakMap<Schema.Top, JSONSchema7>()

export function fromSchema(schema: Schema.Top): JSONSchema7 {
  const cached = cache.get(schema)
  if (cached) return cached

  const document = Schema.toJsonSchemaDocument(schema, { additionalProperties: true })
  const result = normalize({
    $schema: JsonSchema.META_SCHEMA_URI_DRAFT_2020_12,
    ...document.schema,
    ...(Object.keys(document.definitions).length > 0 ? { $defs: document.definitions } : {}),
  })
  if (!isJsonSchema(result)) throw new Error("tool JSON Schema helper produced a non-schema value")
  cache.set(schema, result)
  return result
}

export function fromTool(tool: Tool.Def): JSONSchema7 {
  return tool.jsonSchema ?? fromSchema(tool.parameters as Schema.Top)
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize)
  if (!isRecord(value)) return value

  const schema = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]))

  if (schema.additionalProperties === true) delete schema.additionalProperties

  if (Array.isArray(schema.anyOf)) {
    const withoutNull = schema.anyOf.filter((item) => !isRecord(item) || item.type !== "null")
    if (withoutNull.length !== schema.anyOf.length) return normalize({ ...schema, anyOf: withoutNull })

    const number = withoutNull.find((item) => isRecord(item) && item.type === "number")
    const nonFinite = withoutNull.filter(
      (item) => isRecord(item) && Array.isArray(item.enum) && item.enum.every((entry) => isNonFiniteNumber(entry)),
    )
    if (number && nonFinite.length === withoutNull.length - 1) {
      const { anyOf: _, ...rest } = schema
      return normalize({ ...number, ...rest })
    }

    if (isEmptyStructUnion(withoutNull)) {
      const { anyOf: _, ...rest } = schema
      return normalize({ type: "object", properties: {}, ...rest })
    }

    if (withoutNull.length === 1 && isRecord(withoutNull[0])) {
      const { anyOf: _, ...rest } = schema
      return normalize({ ...withoutNull[0], ...rest })
    }
  }

  if (Array.isArray(schema.allOf) && schema.allOf.every(isRecord)) {
    const { allOf, ...rest } = schema
    return normalize({ ...Object.assign({}, ...allOf), ...rest })
  }

  if (schema.type === "integer" && schema.maximum === undefined) {
    return { ...schema, maximum: Number.MAX_SAFE_INTEGER }
  }

  return schema
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isJsonSchema(value: unknown): value is JSONSchema7 {
  return typeof value === "boolean" || isRecord(value)
}

function isNonFiniteNumber(value: unknown) {
  return value === "NaN" || value === "Infinity" || value === "-Infinity"
}

function isEmptyStructUnion(items: unknown[]) {
  return (
    items.length === 2 &&
    items.some((item) => isRecord(item) && item.type === "object" && item.properties === undefined) &&
    items.some((item) => isRecord(item) && item.type === "array" && item.items === undefined)
  )
}

export * as ToolJsonSchema from "./json-schema"
