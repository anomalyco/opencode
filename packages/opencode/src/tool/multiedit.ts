import path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { EditTool } from "./edit"
import DESCRIPTION from "./multiedit.txt"
import { InstanceState } from "@/effect/instance-state"

const EditEntry = Schema.Struct({
  oldString: Schema.String.annotate({ description: "The text to replace" }),
  newString: Schema.String.annotate({
    description: "The text to replace it with (must be different from oldString)",
  }),
  replaceAll: Schema.optional(Schema.Boolean).annotate({
    description: "Replace all occurrences of oldString (default false)",
  }),
})

export const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({ description: "The absolute path to the file to modify" }),
  edits: Schema.Array(EditEntry).annotate({
    description: "Array of edit operations to perform sequentially on the file",
  }),
})

export const MultiEditTool = Tool.define(
  "multiedit",
  Effect.gen(function* () {
    const editInfo = yield* EditTool
    const edit = yield* editInfo.init()

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const results: Tool.ExecuteResult[] = []
          for (const entry of params.edits) {
            const result = yield* edit.execute(
              {
                filePath: params.filePath,
                oldString: entry.oldString,
                newString: entry.newString,
                replaceAll: entry.replaceAll,
              },
              ctx,
            )
            results.push(result)
          }
          return {
            title: path.relative(instance.worktree, params.filePath),
            metadata: {
              results: results.map((r) => r.metadata),
            },
            output: results.at(-1)!.output,
          }
        }),
    }
  }),
)
