import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { EditTool } from "./edit"
import DESCRIPTION from "./multiedit.txt"
import path from "path"
import { Instance } from "../project/instance"

export const MultiEditTool = Tool.define(
  "multiedit",
  Effect.gen(function* () {
    const editInfo = yield* EditTool
    const edit = yield* editInfo.init()

    return {
      description: DESCRIPTION,
      parameters: z.object({
        filePath: z.string().describe("The absolute path to the file to modify"),
        edits: z
          .array(
            z.object({
              filePath: z.string().describe("The absolute path to the file to modify"),
              oldString: z.string().describe("The text to replace"),
              newString: z.string().describe("The text to replace it with (must be different from oldString)"),
              replaceAll: z.boolean().optional().describe("Replace all occurrences of oldString (default false)"),
            }),
          )
          .describe("Array of edit operations to perform sequentially on the file"),
      }),
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
