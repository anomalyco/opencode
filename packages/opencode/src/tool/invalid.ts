import { Effect, Schema } from "effect"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  tool: Schema.String,
  error: Schema.String,
})

export const InvalidTool = Tool.define(
  "invalid",
  Effect.succeed({
    description: "Do not use",
    parameters: Parameters,
    execute: (params: { tool: string; error: string }) =>
      Effect.succeed({
        title: "Invalid Tool",
        // Strip provider control tokens (e.g. <|tool_call_begin|>) so malformed arguments echoed back
        // as the tool result don't re-prime the model to emit more invalid tool calls.
        output: `The arguments provided to the tool are invalid: ${params.error.replace(/<\|\/?[a-z0-9_]+\|>/gi, "")}`,
        metadata: {},
      }),
  }),
)
