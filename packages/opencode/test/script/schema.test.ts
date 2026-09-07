import { describe, expect, test } from "bun:test"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { generateEffect, MODEL_REF, restoreModelRefs } from "../../script/schema"

const CUSTOM = "internal/Qwen/Qwen3-Coder-30B-A3B-Instruct"
const KNOWN = "anthropic/claude-2"
const KNOWN_MODELS = [KNOWN] as const

const ISSUE_EXAMPLE = {
  $schema: "https://opencode.ai/config.json",
  provider: {
    internal: {
      npm: "@ai-sdk/openai-compatible",
      models: {
        "Qwen/Qwen3-Coder-30B-A3B-Instruct": {},
      },
    },
  },
  model: CUSTOM,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * JSON Schema 2020-12: `$ref` is applied together with sibling keywords.
 * Stub models.dev `$defs/Model` as a closed enum so this test does not fetch.
 */
function acceptsModelId(schema: unknown, value: string, known: readonly string[]): boolean {
  if (!isRecord(schema)) return false
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.some((option) => acceptsModelId(option, value, known))
  }
  const refOk = schema.$ref !== MODEL_REF || known.includes(value)
  const typeOk = schema.type === undefined || schema.type === "string"
  if (schema.$ref === MODEL_REF || schema.type === "string") return refOk && typeOk
  return false
}

function collectModelIdSchemas(value: unknown, key?: string, out: unknown[] = []): unknown[] {
  if (Array.isArray(value)) {
    for (const item of value) collectModelIdSchemas(item, undefined, out)
    return out
  }
  if (!isRecord(value)) return out
  if ((key === "model" || key === "small_model") && isModelIdSchema(value)) out.push(value)
  for (const [name, item] of Object.entries(value)) collectModelIdSchemas(item, name, out)
  return out
}

function isModelIdSchema(schema: Record<string, unknown>): boolean {
  if (schema.type === "string") return true
  if (schema.$ref === MODEL_REF) return true
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.some((item) => isRecord(item) && isModelIdSchema(item))
  }
  return false
}

const modelFields = {
  type: "object",
  properties: {
    model: {
      type: "string",
      description: "Model to use in the format of provider/model, eg anthropic/claude-2",
    },
    small_model: {
      type: "string",
      description: "Small model to use for tasks like title generation in the format of provider/model",
    },
    agent: {
      type: "object",
      additionalProperties: {
        type: "object",
        properties: {
          model: { type: "string" },
        },
      },
    },
    command: {
      type: "object",
      additionalProperties: {
        type: "object",
        properties: {
          model: { type: "string" },
        },
      },
    },
  },
}

describe("restoreModelRefs", () => {
  test("accepts custom provider/model from the published schema example", () => {
    const schema = restoreModelRefs(modelFields)
    const fields = collectModelIdSchemas(schema)
    expect(fields.length).toBe(4)
    for (const field of fields) {
      expect(acceptsModelId(field, ISSUE_EXAMPLE.model, KNOWN_MODELS)).toBe(true)
    }
  })

  test("still accepts a normal models.dev id as a string", () => {
    const schema = restoreModelRefs(modelFields)
    for (const field of collectModelIdSchemas(schema)) {
      expect(acceptsModelId(field, KNOWN, KNOWN_MODELS)).toBe(true)
    }
  })
})

describe("generated config schema", () => {
  test("does not reject custom provider/model on Config.model and nested model fields", () => {
    const schema = generateEffect(ConfigV1.Info)
    const fields = collectModelIdSchemas(schema)
    expect(fields.length).toBeGreaterThanOrEqual(4)
    for (const field of fields) {
      expect(acceptsModelId(field, CUSTOM, KNOWN_MODELS)).toBe(true)
      expect(acceptsModelId(field, KNOWN, KNOWN_MODELS)).toBe(true)
    }
  })
})
