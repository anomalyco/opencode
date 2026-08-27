import { Config } from "@opencode-ai/tui/config"
import { Schema } from "effect"

export const SchemaURL = "https://opencode.ai/v2/cli.json"

export const Info = Schema.Struct({
  $schema: Schema.optional(Schema.String).annotate({ description: "JSON Schema for CLI configuration" }),
  ...Config.Info.fields,
})
export type Info = Schema.Schema.Type<typeof Info>
