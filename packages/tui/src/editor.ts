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

const terminalEditors = new Set(["vim", "nvim", "vi", "nano", "micro", "emacs", "kak", "hx", "helix", "joe", "mcedit"])
const gotoEditors = new Set(["code", "code-insiders", "codium", "cursor", "windsurf", "trae"])
const colonEditors = new Set(["subl", "sublime_text", "atom", "zed", "zeditor", "hx", "helix"])

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

export type EditorBatchInvocation = EditorInvocation & {
  /** Every target opens in one editor process; otherwise launch each target. */
  batch: boolean
}

export function buildEditorBatchInvocation(input: {
  editor: string
  files: readonly EditorTarget[]
  platform?: NodeJS.Platform
}): EditorBatchInvocation {
  const parts = splitCommand(input.editor)
  const command = parts[0]
  if (!command) throw new Error("Set $VISUAL or $EDITOR to open files in an editor")
  const name = editorName(command)
  return {
    command,
    args: [...parts.slice(1), ...targetArgs(name, input.files)],
    terminal: terminalEditors.has(name),
    shell: (input.platform ?? process.platform) === "win32" && !/\.(exe|com)$/i.test(command),
    batch: terminalEditors.has(name) || gotoEditors.has(name) || colonEditors.has(name),
  }
}

function editorName(command: string) {
  return command
    .split(/[\\/]/)
    .pop()!
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|com)$/, "")
}

function targetArgs(name: string, files: readonly EditorTarget[]) {
  if (!files.length) return []
  const first = files[0]!
  const paths = files.map((file) => file.file)
  if (gotoEditors.has(name)) {
    if (!files.some((file) => file.line)) return paths
    return ["--goto", ...files.map(locationArg)]
  }
  if (colonEditors.has(name)) return files.map(locationArg)
  if (name === "emacs")
    return first.line ? [`+${first.line}${first.column ? `:${first.column}` : ""}`, ...paths] : paths
  if (name === "nano" || name === "micro" || name === "kak")
    return first.line ? [`+${first.line}${first.column ? `,${first.column}` : ""}`, ...paths] : paths
  if (name === "vim" || name === "nvim" || name === "vi") return first.line ? [`+${first.line}`, ...paths] : paths
  return [first.file]
}

function locationArg(file: EditorTarget) {
  return file.line ? `${file.file}:${file.line}${file.column ? `:${file.column}` : ""}` : file.file
}

export type FileLocation = { path: string; line?: number; column?: number }
export type FileOpenFailure = { path: string; message: string }
export type FileOpenResult = { opened: number; failures: FileOpenFailure[] }

/**
 * Opens resolved local paths with the user's editor, one process when the
 * editor accepts several targets. Directories open in the system file manager.
 * Without an editor, files open with the OS default handler except launchable
 * types, which would run instead of display. Repeated paths open once with the
 * first location winning.
 */
export async function openFilesAtLocation(input: {
  files: readonly FileLocation[]
  renderer: CliRenderer
  cwd?: string
}): Promise<FileOpenResult> {
  const unique = new Map<string, FileLocation>()
  for (const file of input.files) if (!unique.has(file.path)) unique.set(file.path, file)

  const failures: FileOpenFailure[] = []
  const pending: { file: FileLocation; stat: Stats }[] = []
  let opened = 0
  const openedOnce = () => {
    opened++
  }
  const openFailed = (file: string) => (error: unknown) => {
    failures.push(failure(file, error))
  }

  for (const file of unique.values()) {
    const stat = statSync(file.path, { throwIfNoEntry: false })
    if (!stat) {
      failures.push({ path: file.path, message: `Path does not exist: ${file.path}` })
      continue
    }
    if (stat.isDirectory()) {
      // Opening a macOS bundle launches the app; reveal bundles in the file manager instead.
      const target = process.platform === "darwin" && file.path.endsWith(".app") ? path.dirname(file.path) : file.path
      await openPath(target).then(openedOnce, openFailed(file.path))
      continue
    }
    pending.push({ file, stat })
  }

  if (!pending.length) return { opened, failures }
  const editor = process.env.VISUAL || process.env.EDITOR
  if (!editor) {
    for (const target of pending) {
      if (isLaunchable(target.file.path, target.stat)) {
        failures.push({ path: target.file.path, message: refusal(target.file.path) })
        continue
      }
      await openPath(target.file.path).then(openedOnce, openFailed(target.file.path))
    }
    return { opened, failures }
  }

  const cwd = input.cwd && existsSync(input.cwd) ? input.cwd : process.cwd()
  const invocation = buildEditorBatchInvocation({
    editor,
    files: pending.map((target) => ({ file: target.file.path, line: target.file.line, column: target.file.column })),
  })
  if (invocation.terminal) {
    await input.renderer.suspend()
    try {
      await runTerminalEditor(invocation, cwd)
      opened += pending.length
    } catch (error) {
      failures.push(failure(pending[0]!.file.path, error))
    } finally {
      await input.renderer.resume()
    }
    return { opened, failures }
  }
  if (!invocation.batch) {
    for (const target of pending) {
      const single = buildEditorBatchInvocation({
        editor,
        files: [{ file: target.file.path, line: target.file.line, column: target.file.column }],
      })
      await launchEditor(single, cwd).then(openedOnce, openFailed(target.file.path))
    }
    return { opened, failures }
  }
  try {
    await launchEditor(invocation, cwd)
    opened += pending.length
  } catch (error) {
    for (const target of pending) {
      if (isLaunchable(target.file.path, target.stat)) {
        failures.push(failure(target.file.path, error))
        continue
      }
      await openPath(target.file.path).then(openedOnce, openFailed(target.file.path))
    }
  }
  return { opened, failures }
}

function failure(file: string, error: unknown): FileOpenFailure {
  return { path: file, message: error instanceof Error ? error.message : String(error) }
}

function refusal(file: string) {
  return `Refusing to launch ${path.basename(file)}: set $VISUAL or $EDITOR to open it`
}

/** Opens one resolved path; see `openFilesAtLocation` for the safety rules. */
export async function openFileAtLocation(input: {
  path: string
  line?: number
  column?: number
  renderer: CliRenderer
  cwd?: string
}) {
  const result = await openFilesAtLocation({
    files: [{ path: input.path, line: input.line, column: input.column }],
    renderer: input.renderer,
    cwd: input.cwd,
  })
  if (result.opened) return
  throw new Error(result.failures[0]?.message ?? `Could not open ${input.path}`)
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

function spawnInvocation(invocation: EditorInvocation, cwd: string) {
  if (!invocation.shell) return spawn(invocation.command, invocation.args, { cwd, stdio: "inherit" })
  const command = [invocation.command, ...invocation.args].map((part) => `"${part}"`).join(" ")
  return spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${command}"`], {
    cwd,
    stdio: "inherit",
    windowsVerbatimArguments: true,
  })
}

function runTerminalEditor(invocation: EditorInvocation, cwd: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawnInvocation(invocation, cwd)
    child.on("error", reject)
    child.on("exit", (code, signal) => {
      if (code === 0) return resolve()
      reject(new Error(`Editor exited with ${signal ? `signal ${signal}` : `code ${code}`}`))
    })
  })
}

function launchEditor(invocation: EditorInvocation, cwd: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawnInvocation(invocation, cwd)
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
