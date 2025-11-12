import z from "zod"
import { $ } from "bun"

/**
 * bat - Cat with wings
 * Syntax highlighting, paging, git integration, line numbers.
 */
export default {
  description: "Cat with wings: syntax highlighting, paging, git integration, line numbers. Examples: 'bat file.ts' shows file with highlighting, 'bat -r 10:20 file.ts' shows lines 10-20, 'bat -p file.ts' plain mode without decorations.",
  args: {
    file: z.string().describe("File path to display"),
    lineRange: z.string().optional().describe("Line range (e.g., '10:20', ':50', '100:')"),
    plain: z.boolean().optional().describe("Plain mode (no decorations)"),
  },
  execute: async (params: { file: string; lineRange?: string; plain?: boolean }) => {
    const args = ["bat"]
    
    if (params.plain) args.push("-p")
    if (params.lineRange) args.push("-r", params.lineRange)
    
    args.push(params.file)
    
    const result = await $`${args}`.quiet().nothrow().text()
    return result || "File not found or empty"
  },
}
