import type { JsonSchema, LanguageModel, LanguageModelSanitizerCompatibility } from "../../schema/index.js"
import { isRecord } from "../../utils/record.js"
import { GeminiJsonSchema } from "./gemini-json-schema.js"

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

const gemini = GeminiJsonSchema.normalize

const MODEL_NAMES = [
  [/gemini/i, "gemini"],
  [/kimi/i, "moonshot"],
] as const

// Tool arguments are always a JSON object, and most providers reject a tool schema whose root does not
// declare `type: "object"`, such as `{}` or a bare `properties` map. Effect encodes an empty struct as
// `anyOf` object or array; every object matches its bare object branch, so that `anyOf` is dropped.
const objectRoot = (schema: JsonSchema): JsonSchema => {
  if (schema.type !== undefined) return schema
  if (
    Array.isArray(schema.anyOf) &&
    schema.anyOf.some((branch) => isRecord(branch) && branch.type === "object" && Object.keys(branch).length === 1)
  )
    return { type: "object", ...Object.fromEntries(Object.entries(schema).filter(([key]) => key !== "anyOf")) }
  return { type: "object", ...schema }
}

// Every tool schema gets an object root. Then an explicit `sanitizer` wins, and `none` opts out.
// Otherwise the protocol's own default applies (the Gemini API always uses Gemini's rules), then the
// model name selects the family's rules so models reached through gateways and OpenAI-compatible
// endpoints get the same handling.
const modelCompatibility = (
  schema: JsonSchema,
  model: LanguageModel,
  protocolDefault?: LanguageModelSanitizerCompatibility,
): JsonSchema => {
  const root = objectRoot(schema)
  switch (model.compatibility?.sanitizer ?? protocolDefault ?? MODEL_NAMES.find(([name]) => name.test(model.id))?.[1]) {
    case "gemini":
      return gemini(root)
    case "moonshot":
      return moonshot(root)
    case "none":
    case undefined:
      return root
  }
}

export const ToolSchemaProjection = {
  gemini,
  modelCompatibility,
  moonshot,
  openAI,
  responses,
} as const
