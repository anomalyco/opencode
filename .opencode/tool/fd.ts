import z from "zod"
import { $ } from "bun"

/**
 * fd - Fast, user-friendly file finder
 * Simpler syntax & blazing speed vs find. Ignores .gitignore by default.
 */
export default {
  description: "Fast, user-friendly file finder. Simpler syntax & blazing speed vs find. Ignores .gitignore by default. Examples: 'fd src' finds 'src' files/dirs, 'fd -e ts' finds TypeScript files, 'fd -t f foo' finds files named 'foo'.",
  args: {
    pattern: z.string().describe("Search pattern (file name or regex)"),
    path: z.string().optional().describe("Directory to search (defaults to current directory)"),
    type: z.enum(["f", "d", "l"]).optional().describe("File type: 'f' (file), 'd' (directory), 'l' (symlink)"),
    extension: z.string().optional().describe("Filter by file extension (e.g., 'ts', 'json')"),
    hidden: z.boolean().optional().describe("Include hidden files"),
  },
  execute: async (params: { pattern: string; path?: string; type?: string; extension?: string; hidden?: boolean }) => {
    const args = ["fd"]
    
    if (params.type) args.push("-t", params.type)
    if (params.extension) args.push("-e", params.extension)
    if (params.hidden) args.push("-H")
    
    args.push(params.pattern)
    if (params.path) args.push(params.path)
    
    const result = await $`${args}`.quiet().nothrow().text()
    return result || "No matches found"
  },
}
