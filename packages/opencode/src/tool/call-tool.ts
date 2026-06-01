import { ToolRuntime, ToolRuntimeError } from "@opencode-ai/database/tool/runtime"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"

const Parameters = Schema.Struct({
  name: Schema.String.annotate({
    description: 'The exact tool name as returned by search_data (e.g. "calculator"). Must match exactly.',
  }),
  args: Schema.String.annotate({
    description:
      'JSON-encoded arguments matching the tool\'s input schema from search_data. Example: if search_data shows "expression (string)", pass \'{"expression": "2 + 3"}\'.',
  }),
})

export const CallTool = Tool.define(
  "call_tool",
  Effect.gen(function* () {
    const runtime = yield* ToolRuntime

    return {
      description:
        "Execute a tool discovered via search_data. Use this when you need a specialized capability not in your standard toolkit. First use search_data to find the tool and see its input schema, then call it here with the exact name and JSON-encoded arguments matching that schema.",
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
