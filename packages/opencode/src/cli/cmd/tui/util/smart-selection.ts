import { spawn } from "child_process"
import { existsSync, statSync } from "fs"
import { homedir } from "os"
import path from "path"

export function handleSmartSelection(text: string): void {
  try {
    const trimmed = text.trim()
    if (trimmed.length === 0) return
    if (trimmed.length > 2000) return
    if (process.platform !== "darwin") return

    if (/^(https?:\/\/\S+)$/.test(trimmed)) {
      spawn("open", [trimmed]).on("error", () => {})
      return
    }

    const resolvedPath = resolvePath(trimmed)
    if (!existsSync(resolvedPath)) return

    const stat = statSync(resolvedPath)
    if (stat.isDirectory()) {
      spawn("open", [resolvedPath]).on("error", () => {})
      return
    }
    spawn("open", ["-R", resolvedPath]).on("error", () => {})
  } catch {
    // silently ignore failures
  }
}

function resolvePath(text: string): string {
  if (text === "~") return homedir()
  if (text.startsWith("~/")) return path.join(homedir(), text.slice(2))
  if (path.isAbsolute(text)) return text
  return path.resolve(process.cwd(), text)
}
