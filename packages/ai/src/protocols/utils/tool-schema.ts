import type { JsonSchema, LanguageModelToolSchemaCompatibility } from "../../schema/index.js"
import { isRecord } from "../../utils/record.js"
import { GeminiToolSchema } from "./gemini-tool-schema.js"

const tupleItemsSchema = (items: ReadonlyArray<unknown>) => {
  const projected = items.map(moonshotNode)
  if (projected.length === 0) return {}
  if (projected.length === 1) return projected[0]
  return { anyOf: projected }
}

// Moonshot rejects an `enum` without a sibling `type`. Its `type` may be one type, or one type plus "null".
const enumType = (values: ReadonlyArray<unknown>) => {
  const types = [
    ...new Set(values.map((value) => (value === null ? "null" : Array.isArray(value) ? "array" : typeof value))),
  ]
  if (types.length === 1) return types[0]
  if (types.length === 2 && types.includes("null")) return [...types.filter((type) => type !== "null"), "null"]
  return undefined
}

const moonshotNode = (schema: unknown): unknown => {
  if (Array.isArray(schema)) return schema.map(moonshotNode)
  if (!isRecord(schema)) return schema
  if (typeof schema.$ref === "string") return { $ref: schema.$ref }
  const type = schema.type === undefined && Array.isArray(schema.enum) ? enumType(schema.enum) : undefined
  return Object.fromEntries([
    ...(type === undefined ? [] : [["type", type]]),
    ...Object.entries(schema).flatMap(([key, value]) => {
      if (key === "items" && Array.isArray(value)) return [[key, tupleItemsSchema(value)]]
      if (key === "prefixItems") {
        if ("items" in schema) return []
        return [["items", tupleItemsSchema(Array.isArray(value) ? value : [])]]
      }
      if (key === "unevaluatedItems") return []
      return [[key, moonshotNode(value)]]
    }),
  ])
}

const moonshot = (schema: JsonSchema): JsonSchema => {
  const projected = moonshotNode(schema)
  return isRecord(projected) ? projected : {}
}

const openAI = (schema: JsonSchema): JsonSchema => schema
const responses = openAI

const gemini = (schema: JsonSchema): JsonSchema => GeminiToolSchema.convert(schema) ?? {}

const modelCompatibility = (
  schema: JsonSchema,
  compatibility: LanguageModelToolSchemaCompatibility | undefined,
): JsonSchema => {
  if (compatibility === undefined) return schema
  switch (compatibility) {
    case "gemini":
      return gemini(schema)
    case "moonshot":
      return moonshot(schema)
  }
}

export const ToolSchemaProjection = {
  gemini,
  modelCompatibility,
  moonshot,
  openAI,
  responses,
} as const
