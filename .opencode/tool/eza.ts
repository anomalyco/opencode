import z from "zod"
import { $ } from "bun"

/**
 * eza - Modern ls
 * Better defaults, icons/trees/git info, readable at a glance.
 */
export default {
  description: "Modern ls. Better defaults, icons/trees/git info, readable at a glance. Examples: 'eza -l' long format, 'eza -T' tree view, 'eza -a' show hidden, 'eza --git' show git status.",
  args: {
    path: z.string().optional().describe("Directory to list (defaults to current)"),
    long: z.boolean().optional().describe("Long format with details"),
    tree: z.boolean().optional().describe("Tree view"),
    all: z.boolean().optional().describe("Show hidden files"),
    git: z.boolean().optional().describe("Show git status"),
  },
  execute: async (params: { path?: string; long?: boolean; tree?: boolean; all?: boolean; git?: boolean }) => {
    const args = ["eza"]
    
    if (params.long) args.push("-l")
    if (params.tree) args.push("-T")
    if (params.all) args.push("-a")
    if (params.git) args.push("--git")
    
    args.push(params.path || ".")
    
    const result = await $`${args}`.quiet().nothrow().text()
    return result || "Directory not found or empty"
  },
}
