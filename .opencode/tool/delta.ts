import z from "zod"
import { $ } from "bun"

/**
 * git-delta - Better git diff/pager
 * Side-by-side, syntax-colored diffs; easier code reviews in terminal.
 */
export default {
  description: "Better git diff/pager. Side-by-side, syntax-colored diffs; easier code reviews in terminal. Examples: 'delta' shows working tree diff, 'delta --cached' shows staged changes, 'delta HEAD~1' shows last commit diff.",
  args: {
    commit: z.string().optional().describe("Git commit/ref to diff (defaults to working tree)"),
    file: z.string().optional().describe("Specific file to diff"),
    cached: z.boolean().optional().describe("Show staged changes"),
  },
  execute: async (params: { commit?: string; file?: string; cached?: boolean }) => {
    const args = ["git", "diff"]
    
    if (params.cached) args.push("--cached")
    if (params.commit) args.push(params.commit)
    if (params.file) args.push("--", params.file)
    
    // Pipe through delta
    const result = await $`${args} | delta`.quiet().nothrow().text()
    return result || "No changes to show"
  },
}
