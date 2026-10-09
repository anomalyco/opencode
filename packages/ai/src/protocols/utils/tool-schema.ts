import { ToolDefinition, type JsonSchema, type LanguageModel, type LLMRequest } from "../../schema/index.js"
import { isRecord } from "../../utils/record.js"
import { GeminiJsonSchema } from "./gemini-json-schema.js"
import { MoonshotJsonSchema } from "./moonshot-json-schema.js"

const moonshot = MoonshotJsonSchema.normalize

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
const modelCompatibility = (schema: JsonSchema, model: LanguageModel): JsonSchema => {
  const root = objectRoot(schema)
  switch (
    model.compatibility?.sanitizer ??
    model.route.sanitizer ??
    MODEL_NAMES.find(([name]) => name.test(model.id))?.[1]
  ) {
    case "gemini":
      return gemini(root)
    case "moonshot":
      return moonshot(root)
    case "none":
    case undefined:
      return root
  }
}

// Applied once to every request before any protocol builds its body, including tools in namespaces.
const tools = (entries: LLMRequest["tools"], model: LanguageModel): LLMRequest["tools"] =>
  entries.map((tool) =>
    tool.type === "tool"
      ? new ToolDefinition({ ...tool, inputSchema: modelCompatibility(tool.inputSchema, model) })
      : { ...tool, tools: tools(tool.tools, model) },
  )

export const ToolSchemaProjection = {
  gemini,
  moonshot,
  openAI,
  responses,
  tools,
} as const
