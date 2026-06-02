import { Schema } from "effect"

export const Browser = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  headless: Schema.optional(Schema.Boolean),
  viewport: Schema.optional(Schema.Struct({
    width: Schema.Int,
    height: Schema.Int,
  })),
}).annotate({ identifier: "BrowserConfig" })

export * as ConfigBrowser from "./browser"
