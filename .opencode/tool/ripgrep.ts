import z from "zod"
import { $ } from "bun"

/**
 * ripgrep - Fast code searcher (recursive grep)
 * Much faster than grep/ack/ag, respects .gitignore, great defaults.
 */
export default {
  description: "Code searcher (recursive grep). Much faster than grep/ack/ag, respects .gitignore, great defaults. Examples: 'rg TODO' finds TODO comments, 'rg -t ts function' searches TypeScript files for 'function', 'rg -i error' case-insensitive search.",
  args: {
    pattern: z.string().describe("Search pattern (regex supported)"),
    path: z.string().optional().describe("Path to search (defaults to current directory)"),
    type: z.string().optional().describe("File type filter (e.g., 'ts', 'js', 'json')"),
    ignoreCase: z.boolean().optional().describe("Case insensitive search"),
    filesWithMatches: z.boolean().optional().describe("Only show file names with matches"),
  },
  execute: async (params: { pattern: string; path?: string; type?: string; ignoreCase?: boolean; filesWithMatches?: boolean }) => {
    const args = ["rg"]
    
    if (params.ignoreCase) args.push("-i")
    if (params.filesWithMatches) args.push("-l")
    if (params.type) args.push("-t", params.type)
    
    args.push(params.pattern)
    if (params.path) args.push(params.path)
    
    const result = await $`${args}`.quiet().nothrow().text()
    return result || "No matches found"
  },
}
