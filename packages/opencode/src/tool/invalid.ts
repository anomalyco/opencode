import { Effect, Schema } from "effect"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  tool: Schema.String,
  error: Schema.String,
})

export function formatInvalidToolError(error: string) {
  const match = /unavailable\s+tool\s+['"]([^'"]+)['"]/i.exec(error)
  if (match) {
    return `The arguments provided to the tool are invalid: Tool '${match[1]}' is not available. See the system prompt for the list of available tools.`
  }
  return `The arguments provided to the tool are invalid: ${error.replace(/\s*Available tools:\s*[\s\S]*$/i, "").trim()}`
}

export const InvalidTool = Tool.define(
  "invalid",
  Effect.succeed({
    description: "Do not use",
    parameters: Parameters,
    execute: (params: { tool: string; error: string }) =>
      Effect.succeed({
        title: "Invalid Tool",
        output: formatInvalidToolError(params.error),
        metadata: {},
      }),
  }),
)
