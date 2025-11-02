import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./cc-glob.txt"
import { GlobTool } from "./glob"

/**
 * cc_glob - Anthropic-native file pattern matching tool
 *
 * This is a wrapper around the standard glob tool that follows
 * Anthropic's naming conventions and integrates with Claude Code's
 * file discovery capabilities.
 */
export const ClaudeCodeGlobTool = Tool.define("cc_glob", {
  description: DESCRIPTION,
  parameters: z.object({
    pattern: z.string().describe("The glob pattern to match files against"),
    path: z
      .string()
      .optional()
      .describe(
        "The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter 'undefined' or 'null' - simply omit it for the default behavior. Must be a valid directory path if provided.",
      ),
  }),
  async execute(params, ctx) {
    // Delegate to the standard glob tool
    const globTool = await GlobTool.init()
    return globTool.execute(params, ctx)
  },
})
