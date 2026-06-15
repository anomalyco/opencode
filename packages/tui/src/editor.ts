import type { CliRenderer } from "@opentui/core"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import type { Stream } from "node:stream"
import { resolveZedDbPath, resolveZedSelection } from "./editor-zed"

type EditorStdio = "inherit" | "pipe" | "ignore" | number | Stream

export function normalizePromptContent(content: string) {
  if (content.endsWith("\r\n")) {
    const body = content.slice(0, -2)
    return !body.includes("\n") && !body.includes("\r") ? body : content
  }

  if (content.endsWith("\n")) {
    const body = content.slice(0, -1)
    return !body.includes("\n") && !body.includes("\r") ? body : content
  }

  return content
}

export async function openEditor(input: { value: string; renderer: CliRenderer; cwd?: string; stdin?: EditorStdio }) {
  const editor = process.env.VISUAL || process.env.EDITOR
  if (!editor) return
  const file = path.join(os.tmpdir(), `${Date.now()}.md`)
  await writeFile(file, input.value)
  input.renderer.suspend()
  input.renderer.currentRenderBuffer.clear()
  try {
    await new Promise<void>((resolve, reject) => {
      const parts = editor.split(" ")
      const child = spawn(parts[0]!, [...parts.slice(1), file], {
        cwd: input.cwd && existsSync(input.cwd) ? input.cwd : process.cwd(),
        stdio: [input.stdin ?? "inherit", "inherit", "inherit"],
        shell: process.platform === "win32",
      })
      child.on("error", reject)
      child.on("exit", (code, signal) => {
        if (code === 0) return resolve()
        reject(new Error(`Editor exited with ${signal ? `signal ${signal}` : `code ${code}`}`))
      })
    })
    return (await readFile(file, "utf8")) || undefined
  } finally {
    await rm(file, { force: true }).catch(() => {})
    input.renderer.currentRenderBuffer.clear()
    input.renderer.resume()
    input.renderer.requestRender()
  }
}

function readEditorLock(file: string) {
  const port = Number.parseInt(path.basename(file, ".lock"), 10)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return undefined
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
    if (value.transport !== undefined && value.transport !== "ws") return undefined
    return {
      port,
      authToken: typeof value.authToken === "string" ? value.authToken : undefined,
      workspaceFolders: Array.isArray(value.workspaceFolders)
        ? value.workspaceFolders.filter((item): item is string => typeof item === "string")
        : [],
    }
  } catch {
    return undefined
  }
}

export function discoverEditorConnection(directory: string) {
  const root = path.join(os.homedir(), ".claude", "ide")
  const contains = (parent: string) => {
    const resolved = path.resolve(parent)
    const relative = path.relative(resolved, path.resolve(directory))
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)) ? resolved.length : 0
  }
  try {
    return readdirSync(root)
      .filter((entry) => entry.endsWith(".lock"))
      .flatMap((entry) => {
        const file = path.join(root, entry)
        const lock = readEditorLock(file)
        if (!lock) return []
        const score = Math.max(0, ...lock.workspaceFolders.map(contains))
        if (!score) return []
        return [
          {
            url: `ws://127.0.0.1:${lock.port}`,
            authToken: lock.authToken,
            source: `lock:${lock.port}`,
            score,
            mtime: statSync(file).mtimeMs,
          },
        ]
      })
      .sort((left, right) => right.score - left.score || right.mtime - left.mtime)
      .map(({ url, authToken, source }) => ({ url, authToken, source }))[0]
  } catch {
    return undefined
  }
}

export function discoverEditorConnectionByPort(port: number) {
  const lock = readEditorLock(path.join(os.homedir(), ".claude", "ide", `${port}.lock`))
  if (!lock) return undefined
  return {
    url: `ws://127.0.0.1:${lock.port}`,
    authToken: lock.authToken,
    source: `env:${lock.port}`,
  }
}

export const editorIntegration = {
  connection: discoverEditorConnection,
  connectionByPort: discoverEditorConnectionByPort,
  selection: (directory: string) => resolveZedSelection(resolveZedDbPath() ?? "", directory),
}
