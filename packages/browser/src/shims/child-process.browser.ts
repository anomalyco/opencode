// Browser-compatible child_process shim.
// Uses a small built-in command set and can optionally delegate to an external
// host runtime such as almostnode for real shell execution.

import { EventEmitter } from "events"
import path from "path"
import { PassThrough } from "stream"
import { _vfs_addDir, _vfs_getFile, _vfs_listAll, _vfs_readdir } from "./fs.browser"

export interface BrowserProcessBridge {
  exec(input: {
    command: string
    args: string[]
    cwd?: string
    env?: Record<string, string>
    stdin?: string
    shell?: boolean | string
    signal?: AbortSignal
  }): Promise<{ stdout: string; stderr: string; code: number }>
}

let processBridge: BrowserProcessBridge | null = null

export function attachProcessBridge(bridge: BrowserProcessBridge): void {
  processBridge = bridge
}

export function detachProcessBridge(): void {
  processBridge = null
}

class FakeChildProcess extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  stdin = new PassThrough()
  pid = 1
  exitCode: number | null = null
  killed = false

  kill(_signal?: string | number) {
    this.killed = true
    this.exitCode = 137
    this.stdout.end()
    this.stderr.end()
    this.emit("exit", 137, "SIGTERM")
    this.emit("close", 137, "SIGTERM")
  }
}

function normalizeSpawnInput(
  command: string,
  argsOrOpts?: string[] | Record<string, any>,
  maybeOpts?: Record<string, any>,
): { args: string[]; opts: Record<string, any> } {
  if (Array.isArray(argsOrOpts)) {
    return { args: argsOrOpts, opts: maybeOpts || {} }
  }

  return { args: [], opts: argsOrOpts || {} }
}

function isRgCommand(command: string): boolean {
  const base = path.posix.basename(command).toLowerCase()
  return base === "rg" || base === "rg.exe"
}

function normalizeSearchPath(input: string | undefined, cwd: string): string {
  if (!input || input === ".") return cwd
  if (input.startsWith("/")) return input
  return path.posix.join(cwd, input)
}

function listFilesInPath(root: string): string[] {
  const normalizedRoot = root.replace(/\/+$/, "") || "/"
  const files: string[] = []

  for (const [filePath] of _vfs_listAll()) {
    if (filePath === normalizedRoot || filePath.startsWith(`${normalizedRoot}/`)) {
      files.push(filePath)
    }
  }

  files.sort((left, right) => left.localeCompare(right))
  return files
}

function relativeFromRoot(root: string, filePath: string): string {
  if (root === "/") return filePath.slice(1)
  return filePath.slice(root.length + 1)
}

function runRipgrep(args: string[], cwd: string): { stdout: string; stderr: string; code: number } {
  if (args.includes("--files")) {
    const searchRoot = normalizeSearchPath(args.at(-1), cwd)
    const files = listFilesInPath(searchRoot).map((filePath) => relativeFromRoot(searchRoot, filePath))
    return {
      stdout: files.join("\n") + (files.length > 0 ? "\n" : ""),
      stderr: "",
      code: 0,
    }
  }

  const regexIndex = args.indexOf("--regexp")
  const pattern = regexIndex >= 0 ? args[regexIndex + 1] : args[0]
  const searchRoot = normalizeSearchPath(args.at(-1), cwd)
  if (!pattern) {
    return { stdout: "", stderr: "rg: missing pattern", code: 2 }
  }

  const matcher = new RegExp(pattern, "g")
  const lines: string[] = []

  for (const filePath of listFilesInPath(searchRoot)) {
    const content = _vfs_getFile(filePath)
    if (content === undefined) continue

    const split = content.split(/\r?\n/)
    split.forEach((line, index) => {
      matcher.lastIndex = 0
      if (matcher.test(line)) {
        lines.push(`${filePath}|${index + 1}|${line}`)
      }
    })
  }

  if (lines.length === 0) {
    return { stdout: "", stderr: "", code: 1 }
  }

  return {
    stdout: lines.join("\n") + "\n",
    stderr: "",
    code: 0,
  }
}

async function executeCommand(
  command: string,
  args: string[],
  opts: Record<string, any> = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  const cwd = opts.cwd || "/workspace"

  if (isRgCommand(command)) {
    return runRipgrep(args, cwd)
  }

  if (processBridge) {
    return processBridge.exec({
      command,
      args,
      cwd,
      env: opts.env,
      stdin: typeof opts.input === "string" ? opts.input : undefined,
      shell: opts.shell,
      signal: opts.signal,
    })
  }

  if ((command === "sh" || command === "bash") && args[0] === "-c" && args[1]) {
    return executeCommand(args[1], [], { ...opts, shell: true })
  }

  if (opts.shell) {
    return {
      stdout: "",
      stderr: `[browser sandbox] Shell execution is unavailable for '${command}'.`,
      code: 127,
    }
  }

  if (command === "echo") {
    return { stdout: args.join(" ") + "\n", stderr: "", code: 0 }
  }

  if (command === "cat") {
    const content = _vfs_getFile(normalizeSearchPath(args[0], cwd))
    if (content !== undefined) {
      return { stdout: content, stderr: "", code: 0 }
    }
    return { stdout: "", stderr: `cat: ${args[0]}: No such file or directory`, code: 1 }
  }

  if (command === "ls") {
    try {
      const dir = normalizeSearchPath(args[0] || cwd, cwd)
      const entries = _vfs_readdir(dir)
      return { stdout: entries.map((entry) => entry.name).join("\n") + "\n", stderr: "", code: 0 }
    } catch {
      return { stdout: "", stderr: `ls: cannot access '${args[0]}': No such file or directory`, code: 1 }
    }
  }

  if (command === "pwd") {
    return { stdout: `${cwd}\n`, stderr: "", code: 0 }
  }

  if (command === "mkdir") {
    for (const arg of args.filter((value) => !value.startsWith("-"))) {
      _vfs_addDir(normalizeSearchPath(arg, cwd))
    }
    return { stdout: "", stderr: "", code: 0 }
  }

  if (command === "which" || command === "where") {
    return { stdout: "", stderr: `${args[0]}: not found`, code: 1 }
  }

  return {
    stdout: "",
    stderr: `[browser sandbox] Command '${[command, ...args].join(" ")}' is unavailable without a host bridge.`,
    code: 127,
  }
}

export async function runBrowserCommand(input: {
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  stdin?: string
  shell?: boolean | string
  signal?: AbortSignal
}): Promise<{ stdout: string; stderr: string; code: number }> {
  return executeCommand(input.command, input.args ?? [], {
    cwd: input.cwd,
    env: input.env,
    input: input.stdin,
    shell: input.shell,
    signal: input.signal,
  })
}

export function spawn(command: string, argsOrOpts?: any, maybeOpts?: any): any {
  const { args, opts } = normalizeSpawnInput(command, argsOrOpts, maybeOpts)
  const child = new FakeChildProcess()

  setTimeout(async () => {
    try {
      const result = await executeCommand(command, args, opts)
      if (result.stdout) child.stdout.end(result.stdout)
      else child.stdout.end()
      if (result.stderr) child.stderr.end(result.stderr)
      else child.stderr.end()
      child.exitCode = result.code
      child.emit("exit", result.code, null)
      child.emit("close", result.code, null)
    } catch (error: any) {
      child.stderr.end(error?.message || "Command failed")
      child.stdout.end()
      child.exitCode = 1
      child.emit("exit", 1, null)
      child.emit("close", 1, null)
    }
  }, 0)

  return child
}

export function execSync(command: string): string {
  return `[browser] Command not available: ${command}`
}

export function exec(command: string, callback?: Function): any {
  const child = spawn("sh", ["-c", command])
  let stdout = ""
  let stderr = ""
  child.stdout.on("data", (data: Buffer | string) => {
    stdout += data.toString()
  })
  child.stderr.on("data", (data: Buffer | string) => {
    stderr += data.toString()
  })
  child.on("close", (code: number) => {
    if (callback) callback(code ? new Error(stderr) : null, stdout, stderr)
  })
  return child
}

export function execFile(file: string, args: string[], opts: any, callback?: Function): any {
  if (typeof opts === "function") {
    callback = opts
  }
  return exec(`${file} ${args.join(" ")}`, callback)
}

export function fork(): any {
  throw new Error("fork() not available in browser")
}

export function spawnSync(command: string, args: string[] = []): any {
  if (isRgCommand(command)) {
    const result = runRipgrep(args, "/workspace")
    return {
      status: result.code,
      stdout: Buffer.from(result.stdout),
      stderr: Buffer.from(result.stderr),
      error: null,
    }
  }

  return {
    status: 0,
    stdout: Buffer.from(`[browser] ${command} ${args.join(" ")}`),
    stderr: Buffer.from(""),
    error: null,
  }
}

export default {
  spawn,
  exec,
  execSync,
  execFile,
  fork,
  spawnSync,
  attachProcessBridge,
  detachProcessBridge,
}
