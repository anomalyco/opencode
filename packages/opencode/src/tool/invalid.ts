import { Effect, Schema } from "effect"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  tool: Schema.String,
  error: Schema.String,
  type: Schema.optional(Schema.String),
  hint: Schema.optional(Schema.String),
})

export const InvalidTool = Tool.define(
  "invalid",
  Effect.succeed({
    description: "Do not use",
    parameters: Parameters,
    execute: (params: { tool: string; error: string; type?: string; hint?: string }) =>
      Effect.succeed({
        title: params.type === "unknown_tool" ? "Unknown Tool" : "Invalid Tool Input",
        output: [
          `Tool: ${params.tool}`,
          `Error: ${params.error}`,
          params.hint ? `Hint: ${params.hint}` : undefined,
        ]
          .filter(Boolean)
          .join("\n"),
        metadata: {
          ...(params.type ? { type: params.type } : {}),
          tool: params.tool,
        },
      }),
  }),
)
