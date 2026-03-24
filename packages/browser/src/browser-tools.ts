// Browser-compatible tool implementations using VFS
// These tools operate against the in-memory virtual filesystem

import { tool, jsonSchema } from "ai"
import * as vfs from "./shims/fs.browser"

// Use jsonSchema instead of Zod to avoid Zod v4 incompatibility with Anthropic API
// (Zod v4 omits `type: "object"` which the API requires)

export const readFileTool = tool({
  description: "Read the contents of a file from the virtual filesystem. Use this to understand existing code before making changes.",
  parameters: jsonSchema<{ filePath: string; offset?: number; limit?: number }>({
    type: "object",
    properties: {
      filePath: { type: "string", description: "Absolute path to the file to read" },
      offset: { type: "number", description: "Line number to start reading from (1-indexed)" },
      limit: { type: "number", description: "Maximum number of lines to read" },
    },
    required: ["filePath"],
  }),
  execute: async ({ filePath, offset, limit }) => {
    const resolvedPath = resolvePath(filePath)
    try {
      const content = await vfs.readFile(resolvedPath, "utf-8") as string
      let lines = content.split("\n")

      if (offset && offset > 1) {
        lines = lines.slice(offset - 1)
      }
      if (limit) {
        lines = lines.slice(0, limit)
      }

      const startLine = offset || 1
      const numbered = lines.map((line, i) => `${String(startLine + i).padStart(5)} | ${line}`).join("\n")
      return numbered
    } catch (e: any) {
      if (e.code === "ENOENT") {
        return `Error: File not found: ${filePath}`
      }
      return `Error reading file: ${e.message}`
    }
  },
})

export const writeFileTool = tool({
  description: "Create or overwrite a file in the virtual filesystem.",
  parameters: jsonSchema<{ filePath: string; content: string }>({
    type: "object",
    properties: {
      filePath: { type: "string", description: "Absolute path for the file" },
      content: { type: "string", description: "Full content to write to the file" },
    },
    required: ["filePath", "content"],
  }),
  execute: async ({ filePath, content }) => {
    const resolvedPath = resolvePath(filePath)
    await vfs.writeFile(resolvedPath, content)
    const lines = content.split("\n").length
    return `File written: ${filePath} (${lines} lines)`
  },
})

export const editFileTool = tool({
  description: "Edit a file by replacing a specific string with another. The old_string must match exactly (including whitespace/indentation). Read the file first to get the exact content.",
  parameters: jsonSchema<{ filePath: string; oldString: string; newString: string }>({
    type: "object",
    properties: {
      filePath: { type: "string", description: "Absolute path to the file to edit" },
      oldString: { type: "string", description: "The exact text to find and replace (must be unique in the file)" },
      newString: { type: "string", description: "The replacement text" },
    },
    required: ["filePath", "oldString", "newString"],
  }),
  execute: async ({ filePath, oldString, newString }) => {
    const resolvedPath = resolvePath(filePath)
    try {
      const content = await vfs.readFile(resolvedPath, "utf-8") as string

      if (!content.includes(oldString)) {
        return `Error: Could not find the specified text in ${filePath}. Make sure the old_string matches exactly, including whitespace and indentation.`
      }

      const occurrences = content.split(oldString).length - 1
      if (occurrences > 1) {
        return `Error: Found ${occurrences} occurrences of the specified text. The old_string must be unique. Add more surrounding context to make it unique.`
      }

      const newContent = content.replace(oldString, newString)
      await vfs.writeFile(resolvedPath, newContent)

      let diff = ""
      for (const line of oldString.split("\n")) {
        diff += `- ${line}\n`
      }
      for (const line of newString.split("\n")) {
        diff += `+ ${line}\n`
      }

      return `File edited: ${filePath}\n\n${diff}`
    } catch (e: any) {
      if (e.code === "ENOENT") {
        return `Error: File not found: ${filePath}`
      }
      return `Error editing file: ${e.message}`
    }
  },
})

export const globTool = tool({
  description: "Find files matching a glob pattern. Returns file paths that match.",
  parameters: jsonSchema<{ pattern: string; path?: string }>({
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob pattern (e.g., '**/*.ts', 'src/**/*.tsx')" },
      path: { type: "string", description: "Directory to search in (defaults to /workspace)" },
    },
    required: ["pattern"],
  }),
  execute: async ({ pattern, path: searchPath }) => {
    const basePath = resolvePath(searchPath || "/workspace")
    const allFiles = vfs._vfs_listAll()
    const matches: string[] = []

    for (const [filePath] of allFiles) {
      if (!filePath.startsWith(basePath)) continue

      const relativePath = filePath.slice(basePath.length + 1)
      if (matchGlob(relativePath, pattern)) {
        matches.push(relativePath)
      }
    }

    if (matches.length === 0) {
      return `No files matched pattern "${pattern}" in ${searchPath || "/workspace"}`
    }

    return `Found ${matches.length} file(s):\n${matches.join("\n")}`
  },
})

export const grepTool = tool({
  description: "Search for a pattern in file contents. Returns matching lines with file paths and line numbers.",
  parameters: jsonSchema<{ pattern: string; path?: string; include?: string }>({
    type: "object",
    properties: {
      pattern: { type: "string", description: "Text or regex pattern to search for" },
      path: { type: "string", description: "Directory to search in (defaults to /workspace)" },
      include: { type: "string", description: "File glob pattern to include (e.g., '*.ts')" },
    },
    required: ["pattern"],
  }),
  execute: async ({ pattern, path: searchPath, include }) => {
    const basePath = resolvePath(searchPath || "/workspace")
    const allFiles = vfs._vfs_listAll()
    const results: string[] = []
    let regex: RegExp

    try {
      regex = new RegExp(pattern, "gi")
    } catch {
      regex = new RegExp(escapeRegex(pattern), "gi")
    }

    for (const [filePath, content] of allFiles) {
      if (!filePath.startsWith(basePath)) continue
      if (include && !matchGlob(filePath.split("/").pop()!, include)) continue

      const lines = content.split("\n")
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          const relativePath = filePath.slice(basePath.length + 1)
          results.push(`${relativePath}:${i + 1}: ${lines[i].trim()}`)
          regex.lastIndex = 0
        }
      }
    }

    if (results.length === 0) {
      return `No matches found for "${pattern}"`
    }

    return `Found ${results.length} match(es):\n${results.slice(0, 50).join("\n")}${results.length > 50 ? `\n... and ${results.length - 50} more` : ""}`
  },
})

export const listTool = tool({
  description: "List files and directories in a path.",
  parameters: jsonSchema<{ path?: string }>({
    type: "object",
    properties: {
      path: { type: "string", description: "Directory path to list (defaults to /workspace)" },
    },
    required: [],
  }),
  execute: async ({ path: dirPath }) => {
    const resolvedPath = resolvePath(dirPath || "/workspace")
    try {
      const entries = await vfs.readdir(resolvedPath, { withFileTypes: true })
      if (entries.length === 0) {
        return `Directory is empty: ${dirPath || "/workspace"}`
      }

      const formatted = entries.map((entry: any) => {
        const type = entry.isDirectory() ? "[dir] " : "      "
        return `${type}${entry.name}`
      })

      return formatted.join("\n")
    } catch (e: any) {
      return `Error listing directory: ${e.message}`
    }
  },
})

export const bashTool = tool({
  description: "Run a shell command. Only basic commands are available in the browser sandbox: echo, cat, ls, pwd, mkdir.",
  parameters: jsonSchema<{ command: string }>({
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command to execute" },
    },
    required: ["command"],
  }),
  execute: async ({ command }) => {
    const parts = command.trim().split(/\s+/)
    const cmd = parts[0]
    const args = parts.slice(1)

    const { spawn } = await import("./shims/child-process.browser")

    return new Promise<string>((resolve) => {
      const child = spawn(cmd, args)
      let stdout = ""
      let stderr = ""

      child.stdout.on("data", (data: any) => { stdout += data.toString() })
      child.stderr.on("data", (data: any) => { stderr += data.toString() })
      child.on("close", (code: number) => {
        if (code === 0) {
          resolve(stdout || "(no output)")
        } else {
          resolve(stderr || stdout || `Command exited with code ${code}`)
        }
      })
    })
  },
})

// Helper functions

function resolvePath(inputPath: string): string {
  if (inputPath.startsWith("/")) return inputPath
  return "/workspace/" + inputPath
}

function matchGlob(filepath: string, pattern: string): boolean {
  let regex = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/{{GLOBSTAR}}/g, ".*")

  try {
    return new RegExp("^" + regex + "$").test(filepath)
  } catch {
    return false
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
