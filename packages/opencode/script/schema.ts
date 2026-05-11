#!/usr/bin/env bun

import { z } from "zod"
import { Config } from "@/config/config"
import { zodObject } from "@opencode-ai/core/effect-zod"
import { TuiJsonSchema } from "../src/cli/cmd/tui/config/tui-json-schema"
import { Schema } from "effect"

type JsonSchema = Record<string, unknown>

function generate(schema: z.ZodType) {
  const result = z.toJSONSchema(schema, {
    io: "input", // Generate input shape (treats optional().default() as not required)
    /**
     * We'll use the `default` values of the field as the only value in `examples`.
     * This will ensure no docs are needed to be read, as the configuration is
     * self-documenting.
     *
     * See https://json-schema.org/draft/2020-12/draft-bhutton-json-schema-validation-00#rfc.section.9.5
     */
    override(ctx) {
      const schema = ctx.jsonSchema

      // Preserve strictness: set additionalProperties: false for objects
      if (
        schema &&
        typeof schema === "object" &&
        schema.type === "object" &&
        schema.additionalProperties === undefined
      ) {
        schema.additionalProperties = false
      }

      // Add examples and default descriptions for string fields with defaults
      if (schema && typeof schema === "object" && "type" in schema && schema.type === "string" && schema?.default) {
        if (!schema.examples) {
          schema.examples = [schema.default]
        }

        schema.description = [schema.description || "", `default: \`${formatDefault(schema.default)}\``]
          .filter(Boolean)
          .join("\n\n")
          .trim()
      }
    },
  }) as Record<string, unknown> & {
    allowComments?: boolean
    allowTrailingCommas?: boolean
  }

  // used for json lsps since config supports jsonc
  result.allowComments = true
  result.allowTrailingCommas = true

  return result
}

function formatDefault(value: unknown) {
  if (typeof value !== "object" || value === null) return String(value)
  return JSON.stringify(value)
}

function generateEffect(schema: Schema.Top) {
  const document = Schema.toJsonSchemaDocument(schema)
  const normalized = normalize({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    ...document.schema,
    $defs: document.definitions,
  })
  if (!isRecord(normalized)) throw new Error("schema generator produced a non-object schema")
  normalized.allowComments = true
  normalized.allowTrailingCommas = true
  return normalized
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
      return { ...rest, anyOf }
    }
  }

  if (Array.isArray(schema.allOf) && schema.allOf.length === 1 && isRecord(schema.allOf[0])) {
    const { allOf: _, ...rest } = schema
    return normalize({ ...schema.allOf[0], ...rest })
  }

  if (schema.type === "integer" && schema.maximum === undefined) {
    return { ...schema, maximum: Number.MAX_SAFE_INTEGER }
  }

  return schema
}

function isRecord(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const configFile = process.argv[2]
const tuiFile = process.argv[3]

console.log(configFile)
await Bun.write(configFile, JSON.stringify(generate(zodObject(Config.Info).strict().meta({ ref: "Config" })), null, 2))

if (tuiFile) {
  console.log(tuiFile)
  await Bun.write(tuiFile, JSON.stringify(generateEffect(TuiJsonSchema.Info), null, 2))
}
