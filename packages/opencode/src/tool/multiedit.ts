import z from "zod"
import { Tool } from "./tool"
import { EditTool } from "./edit"
import DESCRIPTION from "./multiedit.txt"
import path from "path"
import { Instance } from "../project/instance"

export const MultiEditTool = Tool.define("multiedit", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("The absolute path to the file to modify"),
    chunks: z
      .array(
        z.object({
          startLine: z.number().describe("The starting line number of the chunk (1-indexed)"),
          endLine: z.number().describe("The ending line number of the chunk (1-indexed)"),
          targetContent: z.string().describe("The exact string to be replaced within the range"),
          replacementContent: z.string().describe("The content to replace the target content with"),
          allowMultiple: z.boolean().optional().describe("Replace all occurrences of targetContent within range"),
        }),
      )
      .describe("List of chunks to replace. Useful for non-contiguous edits."),
  }),
  async execute(params, ctx) {
    const filePath = path.isAbsolute(params.filePath) ? params.filePath : path.join(Instance.directory, params.filePath)
    const tool = await EditTool.init()
    const results = []

    for (const chunk of params.chunks) {
      // For now, we reuse the existing EditTool's replace logic but we can enhance it later
      // to actually respect the startLine and endLine for better precision.
      const result = await tool.execute(
        {
          filePath,
          oldString: chunk.targetContent,
          newString: chunk.replacementContent,
          replaceAll: chunk.allowMultiple,
        },
        ctx,
      )
      results.push(result)
    }

    return {
      title: path.relative(Instance.worktree, filePath),
      metadata: {
        results: results.map((r) => r.metadata),
      },
      output: results.length > 0 ? results.at(-1)!.output : "No edits performed.",
    }
  },
})
