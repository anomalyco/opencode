#!/usr/bin/env bun

import "zod-openapi/extend"
import { Config } from "../src/config/config"
import { zodToJsonSchema } from "zod-to-json-schema"

const file = process.argv[2]
console.log(file)

const result = zodToJsonSchema(Config.Info, {
  /**
   * We'll use the `default` values of the field as the only value in `examples`.
   * This will ensure no docs are needed to be read, as the configuration is
   * self-documenting.
   *
   * See https://json-schema.org/draft/2020-12/draft-bhutton-json-schema-validation-00#rfc.section.9.5
   */
  postProcess(jsonSchema) {
    const schema = jsonSchema as typeof jsonSchema & {
      examples?: unknown[]
    }
    if (schema && typeof schema === "object" && "type" in schema && schema.type === "string" && schema?.default) {
      if (!schema.examples) {
        schema.examples = [schema.default]
      }

      schema.description = [schema.description || "", `default: \`${schema.default}\``]
        .filter(Boolean)
        .join("\n\n")
        .trim()
    }

    return jsonSchema
  },
}) as Record<string, unknown> & {
  allowComments?: boolean
  allowTrailingCommas?: boolean
}

// used for json lsps since config supports jsonc
result.allowComments = true
result.allowTrailingCommas = true

await Bun.write(file, JSON.stringify(result, null, 2))
