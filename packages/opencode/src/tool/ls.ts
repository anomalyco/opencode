import z from "zod"
import { Tool } from "./tool"
import * as path from "path"
import * as fs from "fs/promises"
import DESCRIPTION from "./ls.txt"
import { Instance } from "../project/instance"

export const IGNORE_PATTERNS = [
  "node_modules",
  "__pycache__",
  ".git",
  "dist",
  "build",
  "target",
  "vendor",
  "bin",
  "obj",
  ".idea",
  ".vscode",
  ".zig-cache",
  "zig-out",
  ".coverage",
  "coverage",
  "tmp",
  "temp",
  ".cache",
  "cache",
  "logs",
  ".venv",
  "venv",
  "env",
]

export const ListTool = Tool.define("list", {
  description: DESCRIPTION,
  parameters: z.object({
    path: z.string().describe("The absolute path to the directory to list (must be absolute, not relative)").optional(),
    ignore: z.array(z.string()).describe("List of glob patterns to ignore").optional(),
  }),
  async execute(params) {
    const searchPath = path.resolve(Instance.directory, params.path || ".")

    // Read immediate children only (no recursion)
    const entries = await fs.readdir(searchPath, { withFileTypes: true })

    // Combine default ignore patterns with user-provided ones
    const ignorePatterns = [...IGNORE_PATTERNS, ...(params.ignore || [])]

    // Filter entries based on ignore patterns
    const filtered = entries.filter((entry) => {
      // Check if entry name matches any ignore pattern
      return !ignorePatterns.some((pattern) => {
        // Remove trailing slashes for comparison
        const cleanPattern = pattern.replace(/\/+$/, "")
        return entry.name === cleanPattern || entry.name.startsWith(cleanPattern + ".")
      })
    })

    // Sort: directories first (with trailing /), then files
    const sorted = filtered.sort((a, b) => {
      // Directories come first
      if (a.isDirectory() && !b.isDirectory()) return -1
      if (!a.isDirectory() && b.isDirectory()) return 1
      // Within same type, sort alphabetically
      return a.name.localeCompare(b.name)
    })

    // Format output
    const items = sorted.map((entry) => {
      const name = entry.isDirectory() ? `${entry.name}/` : entry.name
      return `  ${name}`
    })

    const output = `${searchPath}/\n${items.join("\n")}`

    return {
      title: path.relative(Instance.worktree, searchPath) || ".",
      metadata: {
        count: filtered.length,
        directories: filtered.filter((e) => e.isDirectory()).length,
        files: filtered.filter((e) => !e.isDirectory()).length,
      },
      output,
    }
  },
})
