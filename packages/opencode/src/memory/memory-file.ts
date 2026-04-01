import path from "path"
import fs from "fs/promises"
import { Log } from "../util/log"
import { MemoryStore } from "./store"

const log = Log.create({ service: "memory.file" })

const TYPE_LABELS: Record<string, string> = {
  "error-solution": "🔧 Error Solutions",
  "build-command": "⌨️ Build Commands",
  preference: "💡 Preferences",
  decision: "🏗️ Architecture Decisions",
  "config-pattern": "⚙️ Config Patterns",
  general: "📝 General",
}

export namespace MemoryFile {
  export function memoryFilePath(projectDir: string) {
    return path.join(projectDir, ".opencode", "MEMORY.md")
  }

  export async function readMemoryFile(projectDir: string): Promise<string | null> {
    const filepath = memoryFilePath(projectDir)
    try {
      return await fs.readFile(filepath, "utf-8")
    } catch {
      return null
    }
  }

  export async function writeMemoryFile(projectDir: string, content: string): Promise<void> {
    const filepath = memoryFilePath(projectDir)
    await fs.mkdir(path.dirname(filepath), { recursive: true })
    // Write to temp file first, then rename for atomicity
    const tmpPath = filepath + ".tmp"
    await fs.writeFile(tmpPath, content, "utf-8")
    await fs.rename(tmpPath, filepath)
  }

  export async function updateMemoryFile(projectDir: string): Promise<void> {
    const sections = MemoryStore.compact(projectDir)
    if (Object.keys(sections).length === 0) return

    const lines: string[] = [
      "# Auto-generated Memory",
      "",
      `> Last updated: ${new Date().toISOString()}`,
      "> This file is automatically maintained by opencode memory.",
      "> You can edit it — your edits are preserved on next extraction.",
      "> Add to .gitignore if you don't want to track it.",
      "",
    ]

    for (const [type, memories] of Object.entries(sections)) {
      lines.push(`## ${TYPE_LABELS[type] ?? type}`)
      lines.push("")
      for (const m of memories) {
        lines.push(`- ${m.content}`)
      }
      lines.push("")
    }

    const filepath = memoryFilePath(projectDir)
    await fs.mkdir(path.dirname(filepath), { recursive: true })

    // Append .opencode/MEMORY.md to .gitignore if it exists
    try {
      const gitignorePath = path.join(projectDir, ".gitignore")
      const gitignore = await fs.readFile(gitignorePath, "utf-8")
      const entry = ".opencode/MEMORY.md"
      if (!gitignore.includes(entry)) {
        await fs.appendFile(gitignorePath, `\n${entry}\n`, "utf-8")
      }
    } catch {
      // .gitignore doesn't exist — don't create it
    }

    await writeMemoryFile(projectDir, lines.join("\n"))
    log.info("updated memory file", { path: memoryFilePath(projectDir) })
  }
}
