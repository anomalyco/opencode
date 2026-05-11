#!/usr/bin/env bun

import { Config } from "@/config/config"
import { Schema } from "effect"
import { TuiJsonSchema } from "../src/cli/cmd/tui/config/tui-json-schema"

type JsonSchema = Record<string, unknown>
const MODEL_REF = "https://models.dev/model-schema.json#/$defs/Model"

function generateEffect(schema: Schema.Top) {
  const document = Schema.toJsonSchemaDocument(schema)
  const normalized = normalize({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    ...document.schema,
    $defs: document.definitions,
  })
  if (!isRecord(normalized)) throw new Error("schema generator produced a non-object schema")
  const restored = restoreModelRefs(normalized)
  if (!isRecord(restored)) throw new Error("schema generator produced a non-object schema")
  restored.allowComments = true
  restored.allowTrailingCommas = true
  return restored
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize)
  if (!isRecord(value)) return value

  const schema = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]))

  if (Array.isArray(schema.anyOf)) {
    const anyOf = schema.anyOf.filter((item) => !isRecord(item) || item.type !== "null")
    if (anyOf.length !== schema.anyOf.length) {
      const { anyOf: _, ...rest } = schema
      if (anyOf.length === 1 && isRecord(anyOf[0])) return normalize({ ...anyOf[0], ...rest })
      return order({ ...rest, anyOf })
    }
  }

  if (Array.isArray(schema.allOf) && schema.allOf.length === 1 && isRecord(schema.allOf[0])) {
    const { allOf: _, ...rest } = schema
    return normalize({ ...schema.allOf[0], ...rest })
  }

  if (schema.type === "integer" && schema.maximum === undefined) {
    return order({ ...schema, maximum: Number.MAX_SAFE_INTEGER })
  }

  return order(schema)
}

function restoreModelRefs(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) return value.map((item) => restoreModelRefs(item))
  if (!isRecord(value)) return value

  const schema = Object.fromEntries(Object.entries(value).map(([name, item]) => [name, restoreModelRefs(item, name)]))
  if ((key === "model" || key === "small_model") && schema.type === "string") {
    return order({ ...schema, $ref: MODEL_REF })
  }
  return order(schema)
}

function order(schema: JsonSchema) {
  const result: JsonSchema = {}
  for (const key of [
    "$schema",
    "$ref",
    "type",
    "const",
    "enum",
    "anyOf",
    "properties",
    "required",
    "propertyNames",
    "additionalProperties",
    "items",
    "prefixItems",
    "$defs",
    "minimum",
    "exclusiveMinimum",
    "maximum",
    "exclusiveMaximum",
    "pattern",
    "description",
    "default",
    "examples",
    "allowComments",
    "allowTrailingCommas",
  ]) {
    if (key in schema) result[key] = schema[key]
  }
  for (const [key, value] of Object.entries(schema)) {
    if (!(key in result)) result[key] = value
  }
  return result
}

function isRecord(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const configFile = process.argv[2]
const tuiFile = process.argv[3]

console.log(configFile)
await Bun.write(configFile, JSON.stringify(generateEffect(Config.Info), null, 2))

if (tuiFile) {
  console.log(tuiFile)
  await Bun.write(tuiFile, JSON.stringify(generateEffect(TuiJsonSchema.Info), null, 2))
}
