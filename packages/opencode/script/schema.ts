#!/usr/bin/env bun

import { z } from "zod"
import { Config } from "../src/config/config"

const file = process.argv[2]
console.log(file)

const result = z.toJSONSchema(Config.Info, {
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
    if (schema && typeof schema === "object" && schema.type === "object" && schema.additionalProperties === undefined) {
      schema.additionalProperties = false
    }

    // Add examples and default descriptions for string fields with defaults
    if (schema && typeof schema === "object" && "type" in schema && schema.type === "string" && schema?.default) {
      if (!schema.examples) {
        schema.examples = [schema.default]
      }

      schema.description = [schema.description || "", `default: \`${schema.default}\``]
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

await Bun.write(file, JSON.stringify(result, null, 2))
