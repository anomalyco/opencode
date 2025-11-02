import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./cc-write.txt"
import { WriteTool } from "./write"

/**
 * cc_write - Anthropic-native file writing tool
 *
 * This is a wrapper around the standard write tool that follows
 * Anthropic's naming conventions and integrates with Claude Code's
 * file writing capabilities.
 */
export const ClaudeCodeWriteTool = Tool.define("cc_write", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z
      .string()
      .describe("The absolute path to the file to write (must be absolute, not relative)"),
    content: z.string().describe("The content to write to the file"),
  }),
  async execute(params, ctx) {
    // Delegate to the standard write tool
    const writeTool = await WriteTool.init()
    return writeTool.execute(params, ctx)
  },
})
