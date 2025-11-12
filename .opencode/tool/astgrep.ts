import z from "zod"
import { $ } from "bun"

/**
 * ast-grep - AST-aware code search & refactor
 * Searches syntax, not text. Precise refactors across codebases.
 */
export default {
  description: "AST-aware code search & refactor. Searches syntax, not text. Precise refactors across codebases. Examples: 'sg -p \"if ($A) { $B }\"' finds if statements, 'sg --lang ts -p \"function $F($$$)\"' finds TypeScript functions.",
  args: {
    pattern: z.string().describe("AST pattern to search (e.g., 'if ($A) { $B }')"),
    path: z.string().optional().describe("Path to search (defaults to current directory)"),
    lang: z.string().optional().describe("Language (ts, js, py, rust, etc.)"),
  },
  execute: async (params: { pattern: string; path?: string; lang?: string }) => {
    const args = ["sg", "-p", params.pattern]
    
    if (params.lang) args.push("--lang", params.lang)
    if (params.path) args.push(params.path)
    
    const result = await $`${args}`.quiet().nothrow().text()
    return result || "No matches found"
  },
}
