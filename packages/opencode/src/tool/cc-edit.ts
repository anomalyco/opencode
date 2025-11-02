import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./cc-edit.txt"
import { EditTool } from "./edit"

/**
 * cc_edit - Anthropic-native file editing tool
 *
 * This is a wrapper around the standard edit tool that follows
 * Anthropic's naming conventions and integrates with Claude Code's
 * text editing capabilities.
 */
export const ClaudeCodeEditTool = Tool.define("cc_edit", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("The absolute path to the file to modify"),
    oldString: z.string().describe("The exact text to replace"),
    newString: z
      .string()
      .describe("The text to replace it with (must be different from oldString)"),
    replaceAll: z
      .boolean()
      .optional()
      .describe("Replace all occurrences of oldString (default false)"),
  }),
  async execute(params, ctx) {
    // Delegate to the standard edit tool
    const editTool = await EditTool.init()
    return editTool.execute(params, ctx)
  },
})
