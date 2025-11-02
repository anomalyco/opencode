import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./cc-list.txt"
import { ListTool } from "./ls"

/**
 * cc_list - Anthropic-native directory listing tool
 *
 * This is a wrapper around the standard list tool that follows
 * Anthropic's naming conventions and integrates with Claude Code's
 * directory browsing capabilities.
 */
export const ClaudeCodeListTool = Tool.define("cc_list", {
  description: DESCRIPTION,
  parameters: z.object({
    path: z
      .string()
      .optional()
      .describe("The absolute path to the directory to list (must be absolute, not relative)"),
    ignore: z.array(z.string()).optional().describe("List of glob patterns to ignore"),
  }),
  async execute(params, ctx) {
    // Delegate to the standard list tool
    const listTool = await ListTool.init()
    return listTool.execute(params, ctx)
  },
})
