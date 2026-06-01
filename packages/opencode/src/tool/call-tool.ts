import { ToolRuntime, ToolRuntimeError } from "@opencode-ai/database/tool/runtime"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"

const Parameters = Schema.Struct({
  name: Schema.String.annotate({
    description: "The exact name of the tool to call (from search_data results)",
  }),
  args: Schema.String.annotate({
    description: "JSON-encoded arguments matching the tool's input schema",
  }),
})

export const CallTool = Tool.define(
  "call_tool",
  Effect.gen(function* () {
    const runtime = yield* ToolRuntime

    return {
      description:
        "Call a tool discovered via search_data. Provide the tool name and JSON-encoded arguments matching the tool's input schema.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          let parsed: unknown
          try {
            parsed = JSON.parse(params.args)
          } catch {
            return {
              title: "call_tool error",
              output: `Invalid JSON in args: "${params.args}". Provide valid JSON matching the tool's input schema.`,
              metadata: {},
            }
          }

          const result = yield* runtime
            .execute(params.name, parsed)
            .pipe(
              Effect.catchTag("ToolRuntimeError", (e: ToolRuntimeError) =>
                Effect.succeed({ _error: e.message } as any),
              ),
            )

          if ("_error" in result) {
            return {
              title: `Error calling "${params.name}"`,
              output: (result as any)._error,
              metadata: {},
            }
          }

          const output = typeof result === "string" ? result : JSON.stringify(result, null, 2)
          return { title: params.name, output, metadata: {} }
        }).pipe(Effect.orDie),
    }
  }),
)
