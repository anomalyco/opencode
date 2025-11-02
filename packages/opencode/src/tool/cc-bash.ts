import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./cc-bash.txt"
import { BashTool } from "./bash"

/**
 * cc_bash - Anthropic-native bash execution tool
 *
 * This is a wrapper around the standard bash tool that follows
 * Anthropic's naming conventions and integrates with Claude Code's
 * code execution capabilities.
 */
export const ClaudeCodeBashTool = Tool.define("cc_bash", {
  description: DESCRIPTION,
  parameters: z.object({
    command: z.string().describe("The bash command to execute"),
    timeout: z.number().optional().describe("Optional timeout in milliseconds (max 600000)"),
    description: z
      .string()
      .describe(
        "Clear, concise description of what this command does in 5-10 words. Examples:\n" +
          "Input: ls\n" +
          "Output: Lists files in current directory\n\n" +
          "Input: git status\n" +
          "Output: Shows working tree status\n\n" +
          "Input: npm install\n" +
          "Output: Installs package dependencies\n\n" +
          "Input: mkdir foo\n" +
          "Output: Creates directory 'foo'",
      ),
  }),
  async execute(params, ctx) {
    // Delegate to the standard bash tool
    const bashTool = await BashTool.init()
    return bashTool.execute(params, ctx)
  },
})
