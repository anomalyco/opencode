import z from "zod"
import * as path from "path"
import { Tool } from "./tool"
import { addMemoryPath, removeMemoryPath } from "../session/system"
import { modify, applyEdits, parse } from "jsonc-parser"
import { Instance } from "../project/instance"
import os from "os"

// Helper to refresh config cache after memory modifications
async function refreshConfig() {
  await Instance.dispose()
}

type ToolResult = { title: string; metadata: Record<string, any>; output: string }

function error(title: string, message: string): ToolResult {
  return { title, metadata: {}, output: `Error: ${message}` }
}

function resolvePath(inputPath: string): string {
  let resolved = inputPath
  if (resolved.startsWith("~/")) {
    resolved = path.join(os.homedir(), resolved.slice(2))
  } else if (!path.isAbsolute(resolved)) {
    resolved = path.join(Instance.directory, resolved)
  }
  return path.normalize(resolved)
}

function toConfigPath(absolutePath: string): string {
  if (absolutePath.startsWith(Instance.directory)) {
    return "./" + path.relative(Instance.directory, absolutePath).replace(/\\/g, "/")
  } else if (absolutePath.startsWith(os.homedir())) {
    return "~/" + path.relative(os.homedir(), absolutePath).replace(/\\/g, "/")
  }
  return absolutePath
}

async function findConfigFile(): Promise<string> {
  const candidates = [
    path.join(Instance.directory, "opencode.jsonc"),
    path.join(Instance.directory, "opencode.json"),
    path.join(Instance.directory, ".opencode", "opencode.jsonc"),
    path.join(Instance.directory, ".opencode", "opencode.json"),
  ]
  for (const candidate of candidates) {
    if (await Bun.file(candidate).exists()) return candidate
  }
  return path.join(Instance.directory, "opencode.json")
}

async function getMemoryFromConfig(): Promise<{ configPath: string; configText: string; memory: string[] }> {
  const configPath = await findConfigFile()
  const configFile = Bun.file(configPath)
  const configText = (await configFile.exists()) ? await configFile.text() : "{}"
  const config = parse(configText) || {}
  const memory: string[] = config.memory || []
  return { configPath, configText, memory }
}

async function addToConfig(filePath: string): Promise<{ configPath: string; configEntry: string }> {
  const { configPath, configText, memory } = await getMemoryFromConfig()
  const configEntry = toConfigPath(filePath)

  if (!memory.includes(configEntry)) {
    const edits = modify(configText, ["memory"], [...memory, configEntry], {
      formattingOptions: { tabSize: 2, insertSpaces: true },
    })
    await Bun.write(configPath, applyEdits(configText, edits))
    addMemoryPath(filePath)
    await refreshConfig()
  }

  return { configPath, configEntry }
}

export const MemoryWriteTool = Tool.define("memory_write", {
  description: `Save information to a memory file that persists across sessions. Use when the user wants to remember something, store project context, or save preferences. Creates the file if it doesn't exist. Always show the user the file path after writing.`,
  parameters: z.object({
    filePath: z.string().describe("Path to the memory file (e.g., './MEMORY.md' or './docs/notes.md')"),
    content: z.string().describe("Content to write"),
    mode: z
      .enum(["overwrite", "append"])
      .default("append")
      .describe("'append' adds to existing content, 'overwrite' replaces it"),
  }),
  async execute(params): Promise<ToolResult> {
    try {
      const resolved = resolvePath(params.filePath)
      const fs = await import("fs/promises")
      await fs.mkdir(path.dirname(resolved), { recursive: true }).catch(() => {})

      let finalContent = params.content
      const file = Bun.file(resolved)
      const exists = await file.exists()

      if (params.mode === "append" && exists) {
        const existing = await file.text()
        const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : ""
        finalContent = existing + sep + params.content
      }

      await Bun.write(resolved, finalContent)
      const { configEntry } = await addToConfig(resolved)

      return {
        title: path.basename(resolved),
        metadata: { filePath: resolved, mode: params.mode, created: !exists },
        output: `${exists ? "Updated" : "Created"} memory file: ${configEntry}`,
      }
    } catch (e) {
      return error("Write failed", String(e))
    }
  },
})

export const MemoryDeleteTool = Tool.define("memory_delete", {
  description: `Delete a memory file permanently. Use when the user wants to remove a memory file they no longer need. Always show the user the deleted file path.`,
  parameters: z.object({
    filePath: z.string().describe("Path to the memory file to delete"),
  }),
  async execute(params): Promise<ToolResult> {
    try {
      const resolved = resolvePath(params.filePath)
      const { configPath, configText, memory } = await getMemoryFromConfig()

      const configEntry = memory.find((entry) => path.normalize(resolvePath(entry)) === resolved)
      if (!configEntry) return error("Not configured", `"${params.filePath}" is not a configured memory file.`)

      const newMemory = memory.filter((p) => p !== configEntry)
      const edits = modify(configText, ["memory"], newMemory.length ? newMemory : undefined, {
        formattingOptions: { tabSize: 2, insertSpaces: true },
      })
      await Bun.write(configPath, applyEdits(configText, edits))
      removeMemoryPath(resolved)
      await refreshConfig()

      const fs = await import("fs/promises")
      await fs.unlink(resolved).catch(() => {})

      return {
        title: path.basename(resolved),
        metadata: { filePath: resolved, configEntry },
        output: `Deleted memory file: ${configEntry}`,
      }
    } catch (e) {
      return error("Delete failed", String(e))
    }
  },
})

export const MemoryRenameTool = Tool.define("memory_rename", {
  description: `Rename or move a memory file to a new location. Use when the user wants to reorganize or rename their memory files. Always show the user the old and new file paths.`,
  parameters: z.object({
    oldPath: z.string().describe("Current path to the memory file"),
    newPath: z.string().describe("New path for the memory file"),
  }),
  async execute(params): Promise<ToolResult> {
    const oldResolved = resolvePath(params.oldPath)
    const newResolved = resolvePath(params.newPath)

    if (await Bun.file(newResolved).exists()) {
      return error("Path exists", `File already exists at "${newResolved}"`)
    }
    if (!(await Bun.file(oldResolved).exists())) {
      return error("Source not found", `File not found at "${oldResolved}"`)
    }

    try {
      const { configPath, configText, memory } = await getMemoryFromConfig()

      const oldConfigEntry = memory.find((entry) => path.normalize(resolvePath(entry)) === oldResolved)
      if (!oldConfigEntry) return error("Not configured", `"${params.oldPath}" is not a configured memory file.`)

      const fs = await import("fs/promises")
      await fs.mkdir(path.dirname(newResolved), { recursive: true }).catch(() => {})
      await fs.rename(oldResolved, newResolved)

      const newConfigEntry = toConfigPath(newResolved)
      const newMemory = memory.map((p) => (p === oldConfigEntry ? newConfigEntry : p))
      const edits = modify(configText, ["memory"], newMemory, { formattingOptions: { tabSize: 2, insertSpaces: true } })
      await Bun.write(configPath, applyEdits(configText, edits))

      removeMemoryPath(oldResolved)
      addMemoryPath(newResolved)
      await refreshConfig()

      return {
        title: path.basename(newResolved),
        metadata: { oldPath: oldResolved, newPath: newResolved },
        output: `Renamed: ${oldConfigEntry} -> ${newConfigEntry}`,
      }
    } catch (e) {
      return error("Rename failed", String(e))
    }
  },
})
