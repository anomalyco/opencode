import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./cc-read.txt"
import { ReadTool } from "./read"

/**
 * cc_read - Anthropic-native file reading tool
 *
 * This is a wrapper around the standard read tool that follows
 * Anthropic's naming conventions and integrates with Claude Code's
 * file reading capabilities.
 */
export const ClaudeCodeReadTool = Tool.define("cc_read", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("The absolute path to the file to read"),
    offset: z.number().optional().describe("The line number to start reading from (0-based)"),
    limit: z.number().optional().describe("The number of lines to read (defaults to 2000)"),
  }),
  async execute(params, ctx) {
    // Delegate to the standard read tool
    const readTool = await ReadTool.init()
    return readTool.execute(params, ctx)
  },
})
