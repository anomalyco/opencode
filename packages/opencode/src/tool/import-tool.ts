import { ToolRuntime, ToolRuntimeError } from "@opencode-ai/database/tool/runtime"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"

const Parameters = Schema.Struct({
  name: Schema.String.annotate({
    description:
      "The exact name of the tool to activate. Use search_data first to find available tools and their names.",
  }),
})

export const ImportTool = Tool.define(
  "import_tool",
  Effect.gen(function* () {
    const runtime = yield* ToolRuntime

    return {
      description:
        "Import and activate a tool from the catalog so it becomes available for use. Use search_data first to discover tools. The active tool set has a limit; when full, the least recently used tool is evicted.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const sig = yield* runtime.activate(params.name).pipe(
            Effect.catchTag("ToolRuntimeError", (e: ToolRuntimeError) =>
              Effect.succeed({
                name: "",
                description: "",
                input: {},
                output: {},
                _error: e.message,
              } as any),
            ),
          )

          if ("_error" in sig) {
            return {
              title: `Failed to import "${params.name}"`,
              output: (sig as any)._error,
              metadata: {},
            }
          }

          const inputKeys = Object.keys(sig.input).join(", ") || "none"
          const outputKeys = Object.keys(sig.output).join(", ") || "any"

          return {
            title: `Imported tool: ${sig.name}`,
            output: [
              `Tool "${sig.name}" is now active.`,
              `Description: ${sig.description}`,
              `Inputs: ${inputKeys}`,
              `Outputs: ${outputKeys}`,
              "",
              "You can now use this tool directly.",
            ].join("\n"),
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)
