import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./cc-grep.txt"
import { GrepTool } from "./grep"
import { assertValidRegex } from "../util/regex-validator"

/**
 * cc_grep - Anthropic-native content search tool
 *
 * This is a wrapper around the standard grep tool that follows
 * Anthropic's naming conventions and integrates with Claude Code's
 * content search capabilities.
 */
export const ClaudeCodeGrepTool = Tool.define("cc_grep", {
  description: DESCRIPTION,
  parameters: z.object({
    pattern: z.string().describe("The regex pattern to search for in file contents"),
    include: z
      .string()
      .optional()
      .describe('File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")'),
    path: z
      .string()
      .optional()
      .describe("The directory to search in. Defaults to the current working directory."),
  }),
  async execute(params, ctx) {
    // Validate regex pattern for ReDoS vulnerabilities before delegating
    assertValidRegex(params.pattern)

    // Delegate to the standard grep tool
    const grepTool = await GrepTool.init()
    return grepTool.execute(params, ctx)
  },
})
