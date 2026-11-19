import type { CliRenderer } from "@opentui/core"
import { existsSync, readdirSync, readFileSync, statSync, type Stats } from "node:fs"
import { readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import type { Stream } from "node:stream"
import { openPath } from "@opencode/util/open"
import { resolveZedDbPath, resolveZedSelection } from "./editor-zed"

export { normalizePromptContent } from "./prompt/content"

type EditorStdio = "inherit" | "pipe" | "ignore" | number | Stream

export async function openEditor(input: { value: string; renderer: CliRenderer; cwd?: string; stdin?: EditorStdio }) {
  const editor = process.env.VISUAL || process.env.EDITOR
  if (!editor) throw new Error("Set $VISUAL or $EDITOR to open an external editor")
  const file = path.join(os.tmpdir(), `${Date.now()}.md`)
  await writeFile(file, input.value)
  await input.renderer.suspend()
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
    await input.renderer.resume()
  }
}

const gotoEditors = new Set(["code", "code-insiders", "codium", "cursor", "windsurf", "trae"])
const colonEditors = new Set(["subl", "sublime_text", "atom", "zed", "zeditor", "hx", "helix"])
// Unknown editors keep the terminal so their output cannot interleave with the TUI.
const guiEditors = new Set([...gotoEditors, ...colonEditors].filter((name) => name !== "hx" && name !== "helix"))

export type EditorInvocation = {
  command: string
  args: string[]
  /** The editor owns the terminal, so the renderer must suspend until it exits. */
  terminal: boolean
  /** Windows command shims (`.cmd`/`.bat`/bare names) need `cmd.exe` to resolve. */
  shell: boolean
}

/** Splits `$EDITOR` into a command and arguments without invoking a shell. */
export function splitCommand(input: string) {
  const parts: string[] = []
  let current = ""
  let quote: '"' | "'" | undefined
  for (const char of input) {
    if (quote) {
      if (char === quote) quote = undefined
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) parts.push(current)
      current = ""
      continue
    }
    current += char
  }
  if (current) parts.push(current)
  return parts
}

export type EditorTarget = { file: string; line?: number; column?: number }

export function buildEditorInvocation(input: {
  editor: string
  file: EditorTarget
  platform?: NodeJS.Platform
}): EditorInvocation {
  const parts = splitCommand(input.editor)
  const command = parts[0]
  if (!command) throw new Error("Set $VISUAL or $EDITOR to open files in an editor")
  const name = editorName(command)
  return {
    command,
    args: [...parts.slice(1), ...targetArgs(name, input.file)],
    terminal: !guiEditors.has(name),
    shell: (input.platform ?? process.platform) === "win32" && !/\.(exe|com)$/i.test(command),
  }
}

function editorName(command: string) {
  return command
    .split(/[\\/]/)
    .pop()!
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|com)$/, "")
}

function targetArgs(name: string, file: EditorTarget) {
  if (gotoEditors.has(name)) return file.line ? ["--goto", locationArg(file)] : [file.file]
  if (colonEditors.has(name)) return [locationArg(file)]
  if (name === "emacs")
    return file.line ? [`+${file.line}${file.column ? `:${file.column}` : ""}`, file.file] : [file.file]
  if (name === "nano" || name === "micro" || name === "kak")
    return file.line ? [`+${file.line}${file.column ? `,${file.column}` : ""}`, file.file] : [file.file]
  if (name === "vim" || name === "nvim" || name === "vi") return file.line ? [`+${file.line}`, file.file] : [file.file]
  return [file.file]
}

function locationArg(file: EditorTarget) {
  return file.line ? `${file.file}:${file.line}${file.column ? `:${file.column}` : ""}` : file.file
}

/**
 * Opens one resolved local path with the user's editor, or the system handler
 * when no editor is configured. Directories open in the file manager; without
 * an editor, launchable file types are refused because the default handler
 * would run them instead of displaying them.
 */
export async function openFileAtLocation(input: {
  path: string
  line?: number
  column?: number
  renderer: CliRenderer
  cwd?: string
}) {
  const stat = statSync(input.path, { throwIfNoEntry: false })
  if (!stat) throw new Error(`Path does not exist: ${input.path}`)
  if (stat.isDirectory()) {
    // Opening a macOS bundle launches the app; reveal bundles in the file manager instead.
    const target = process.platform === "darwin" && input.path.endsWith(".app") ? path.dirname(input.path) : input.path
    await openPath(target)
    return
  }
  const editor = process.env.VISUAL || process.env.EDITOR
  if (!editor) {
    if (isLaunchable(input.path, stat)) throw new Error(refusal(input.path))
    await openPath(input.path)
    return
  }
  const cwd = input.cwd && existsSync(input.cwd) ? input.cwd : process.cwd()
  const invocation = buildEditorInvocation({
    editor,
    file: { file: input.path, line: input.line, column: input.column },
  })
  if (invocation.terminal) {
    await input.renderer.suspend()
    try {
      await runTerminalEditor(invocation, cwd)
    } finally {
      await input.renderer.resume()
    }
    return
  }
  await launchEditor(invocation, cwd)
}

function refusal(file: string) {
  return `Refusing to launch ${path.basename(file)}: set $VISUAL or $EDITOR to open it`
}

// Extensions whose default handler executes the file rather than displaying it.
const launchableExtensions = new Set([
  ".app",
  ".appdir",
  ".appref-ms",
  ".bat",
  ".chm",
  ".cmd",
  ".com",
  ".command",
  ".cpl",
  ".desktop",
  ".diagcab",
  ".exe",
  ".hta",
  ".inf",
  ".jar",
  ".js",
  ".jse",
  ".lnk",
  ".msc",
  ".msi",
  ".msix",
  ".pif",
  ".pkg",
  ".ps1",
  ".ps1xml",
  ".psc1",
  ".psc2",
  ".reg",
  ".scf",
  ".scr",
  ".sct",
  ".settingcontent-ms",
  ".shb",
  ".shs",
  ".sys",
  ".terminal",
  ".vb",
  ".vbe",
  ".vbs",
  ".workflow",
  ".ws",
  ".wsc",
  ".wsf",
  ".wsh",
])

function isLaunchable(file: string, stat: Stats) {
  if (process.platform !== "win32" && (stat.mode & 0o111) !== 0) return true
  return launchableExtensions.has(path.extname(file).toLowerCase())
}

function spawnInvocation(
  invocation: EditorInvocation,
  cwd: string,
  options: { stdio: "inherit" | "ignore"; detached?: boolean },
) {
  const settings = { cwd, stdio: options.stdio, detached: options.detached, windowsHide: options.detached }
  if (!invocation.shell) return spawn(invocation.command, invocation.args, settings)
  const command = [invocation.command, ...invocation.args].map((part) => `"${part}"`).join(" ")
  return spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${command}"`], {
    ...settings,
    windowsVerbatimArguments: true,
  })
}

function runTerminalEditor(invocation: EditorInvocation, cwd: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawnInvocation(invocation, cwd, { stdio: "inherit" })
    child.on("error", reject)
    child.on("exit", (code, signal) => {
      if (code === 0) return resolve()
      reject(new Error(`Editor exited with ${signal ? `signal ${signal}` : `code ${code}`}`))
    })
  })
}

function launchEditor(invocation: EditorInvocation, cwd: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawnInvocation(invocation, cwd, { stdio: "ignore", detached: true })
    child.on("error", reject)
    child.on("spawn", () => {
      child.unref()
      resolve()
    })
  })
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
        const port = Number.parseInt(path.basename(file, ".lock"), 10)
        if (!Number.isInteger(port) || port <= 0 || port > 65535) return []
        try {
          const value = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
          if (value.transport !== undefined && value.transport !== "ws") return []
          const folders = Array.isArray(value.workspaceFolders)
            ? value.workspaceFolders.filter((item): item is string => typeof item === "string")
            : []
          const score = Math.max(0, ...folders.map(contains))
          if (!score) return []
          return [
            {
              url: `ws://127.0.0.1:${port}`,
              authToken: typeof value.authToken === "string" ? value.authToken : undefined,
              source: `lock:${port}`,
              score,
              mtime: statSync(file).mtimeMs,
            },
          ]
        } catch {
          return []
        }
      })
      .sort((left, right) => right.score - left.score || right.mtime - left.mtime)
      .map(({ url, authToken, source }) => ({ url, authToken, source }))[0]
  } catch {
    return undefined
  }
}

export const editorIntegration = {
  connection: discoverEditorConnection,
  selection: (directory: string) => resolveZedSelection(resolveZedDbPath() ?? "", directory),
}
