import z from "zod"
import { Tool } from "./tool"
import { EditTool } from "./edit"
import { WriteTool } from "./write"
import DESCRIPTION from "./multiedit.txt"
import path from "path"
import { Instance } from "../project/instance"

export const MultiEditTool = Tool.define("multiedit", {
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
  async execute(params, ctx) {
    const tool = await EditTool.init()
    const write = await WriteTool.init()
    const results = []
    for (const edit of params.edits) {
      const result =
        edit.oldString === ""
          ? await write.execute(
              {
                filePath: params.filePath,
                content: edit.newString,
              },
              ctx,
            )
          : await tool.execute(
              {
                filePath: params.filePath,
                edits: [
                  {
                    type: "replace",
                    old_text: edit.oldString,
                    new_text: edit.newString,
                    all: edit.replaceAll,
                  },
                ],
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
  },
})
