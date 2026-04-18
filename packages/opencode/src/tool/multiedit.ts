import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { EditTool } from "./edit"
import DESCRIPTION from "./multiedit.txt"
import path from "path"
import { Instance } from "../project/instance"

export const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({ description: "The absolute path to the file to modify" }),
  edits: Schema.mutable(
    Schema.Array(
      Schema.Struct({
        filePath: Schema.String.annotate({ description: "The absolute path to the file to modify" }),
        oldString: Schema.String.annotate({ description: "The text to replace" }),
        newString: Schema.String.annotate({
          description: "The text to replace it with (must be different from oldString)",
        }),
        replaceAll: Schema.optional(Schema.Boolean).annotate({
          description: "Replace all occurrences of oldString (default false)",
        }),
      }),
    ),
  ).annotate({ description: "Array of edit operations to perform sequentially on the file" }),
})

export const MultiEditTool = Tool.define(
  "multiedit",
  Effect.gen(function* () {
    const editInfo = yield* EditTool
    const edit = yield* editInfo.init()

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (
        params: {
          filePath: string
          edits: Array<{ filePath: string; oldString: string; newString: string; replaceAll?: boolean }>
        },
        ctx: Tool.Context,
      ) =>
        Effect.gen(function* () {
          const results = []
          for (const [, entry] of params.edits.entries()) {
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
            title: path.relative(Instance.worktree, params.filePath),
            metadata: {
              results: results.map((r) => r.metadata),
            },
            output: results.at(-1)!.output,
          }
        }),
    }
  }),
)
