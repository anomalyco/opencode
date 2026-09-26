import { type ChildProcess } from "child_process"
import path from "node:path"
import type { Stream } from "node:stream"
import { scheduler } from "node:timers/promises"
import launch from "cross-spawn"
import { buffer } from "node:stream/consumers"
import { fileURLToPath } from "node:url"
import { errorMessage } from "./error"

export type Stdio = "inherit" | "pipe" | "ignore" | number | Stream
export type Shell = boolean | string

export interface Options {
  cwd?: string
  env?: NodeJS.ProcessEnv | null
  stdin?: Stdio
  stdout?: Stdio
  stderr?: Stdio
  shell?: Shell
  abort?: AbortSignal
  kill?: NodeJS.Signals | number
  timeout?: number
  owned?: boolean
}

export interface RunOptions extends Omit<Options, "stdout" | "stderr"> {
  nothrow?: boolean
}

export interface Result {
  code: number
  stdout: Buffer
  stderr: Buffer
}

export interface TextResult extends Result {
  text: string
}

export class RunFailedError extends Error {
  readonly cmd: string[]
  readonly code: number
  readonly stdout: Buffer
  readonly stderr: Buffer

  constructor(cmd: string[], code: number, stdout: Buffer, stderr: Buffer) {
    const text = stderr.toString().trim()
    super(
      text
        ? `Command failed with code ${code}: ${cmd.join(" ")}\n${text}`
        : `Command failed with code ${code}: ${cmd.join(" ")}`,
    )
    this.name = "ProcessRunFailedError"
    this.cmd = [...cmd]
    this.code = code
    this.stdout = stdout
    this.stderr = stderr
  }
}

export type Child = ChildProcess & { exited: Promise<number> }

type Ownership = { pid: number; timeout: number }

const ownership = new WeakMap<ChildProcess, Ownership>()

export function spawn(cmd: string[], opts: Options = {}): Child {
  if (cmd.length === 0) throw new Error("Command is required")
  if (opts.owned && opts.shell) throw new Error("Owned processes do not support shell")
  opts.abort?.throwIfAborted()

  const ownedWin32 = opts.owned && process.platform === "win32"
  const launchCmd = ownedWin32 ? windowsOwnedCommand(cmd) : cmd
  const proc = launch(launchCmd[0], launchCmd.slice(1), {
    cwd: opts.cwd,
    shell: opts.shell,
    env: opts.env === null ? {} : opts.env ? { ...process.env, ...opts.env } : undefined,
    stdio: [opts.stdin ?? "ignore", opts.stdout ?? "ignore", opts.stderr ?? "ignore"],
    windowsHide: process.platform === "win32",
    detached: opts.owned && process.platform !== "win32",
  })

  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const abort = () => {
    if (closed) return
    if (proc.exitCode !== null || proc.signalCode !== null) return
    closed = true

    proc.kill(opts.kill ?? "SIGTERM")

    const ms = opts.timeout ?? 5_000
    if (ms <= 0) return
    timer = setTimeout(() => proc.kill("SIGKILL"), ms)
  }

  const exited = new Promise<number>((resolve, reject) => {
    const done = () => {
      opts.abort?.removeEventListener("abort", abort)
      if (timer) clearTimeout(timer)
    }

    proc.once("exit", (code, signal) => {
      done()
      resolve(code ?? (signal ? 1 : 0))
    })

    proc.once("error", (error) => {
      done()
      reject(error)
    })
  })
  void exited.catch(() => undefined)

  if (opts.abort) {
    opts.abort.addEventListener("abort", abort, { once: true })
    if (opts.abort.aborted) abort()
  }

  let owner: Ownership | undefined
  try {
    owner = opts.owned && !ownedWin32 ? createOwnership(proc, opts.timeout ?? 5_000) : undefined
  } catch (error) {
    void exited.catch(() => undefined)
    throw error
  }
  if (owner) ownership.set(proc, owner)

  const child = proc as Child
  child.exited = exited
  if (owner) {
    void exited
      .then(
        () => cleanupOwnership(proc, owner),
        () => cleanupOwnership(proc, owner),
      )
      .catch(() => undefined)
  }
  return child
}

export async function run(cmd: string[], opts: RunOptions = {}): Promise<Result> {
  const proc = spawn(cmd, {
    cwd: opts.cwd,
    env: opts.env,
    stdin: opts.stdin,
    shell: opts.shell,
    abort: opts.abort,
    kill: opts.kill,
    timeout: opts.timeout,
    owned: opts.owned,
    stdout: "pipe",
    stderr: "pipe",
  })

  if (!proc.stdout || !proc.stderr) throw new Error("Process output not available")

  const out = await Promise.all([proc.exited, buffer(proc.stdout), buffer(proc.stderr)])
    .then(([code, stdout, stderr]) => ({
      code,
      stdout,
      stderr,
    }))
    .catch((err: unknown) => {
      if (!opts.nothrow) throw err
      return {
        code: 1,
        stdout: Buffer.alloc(0),
        stderr: Buffer.from(errorMessage(err)),
      }
    })
  if (out.code === 0 || opts.nothrow) return out
  throw new RunFailedError(cmd, out.code, out.stdout, out.stderr)
}

// Duplicated in `packages/sdk/js/src/process.ts` because the SDK cannot import
// `opencode` without creating a cycle. Keep both copies in sync.
export async function stop(proc: ChildProcess) {
  const owner = ownership.get(proc)
  if (owner) {
    const child = proc as Child
    signalGroup(owner.pid, "SIGTERM")
    if (!(await processExited(child, owner.timeout))) {
      signalGroup(owner.pid, "SIGKILL")
      if (!(await groupExited(owner.pid, owner.timeout))) throw new Error(`Failed to stop process group ${owner.pid}`)
      await child.exited
      return
    }

    if (await groupExited(owner.pid, owner.timeout)) {
      return
    }

    signalGroup(owner.pid, "SIGKILL")
    if (!(await groupExited(owner.pid, owner.timeout))) throw new Error(`Failed to stop process group ${owner.pid}`)
    return
  }

  if (proc.exitCode !== null || proc.signalCode !== null) return

  if (process.platform !== "win32" || !proc.pid) {
    proc.kill()
    return
  }

  const out = await run(["taskkill", "/pid", String(proc.pid), "/T", "/F"], {
    nothrow: true,
  })

  if (out.code === 0) return
  proc.kill()
}

async function processExited(proc: Child, timeout: number) {
  return await Promise.race([proc.exited.then(() => true), scheduler.wait(timeout).then(() => false)])
}

async function groupExited(pid: number, timeout: number) {
  const deadline = Date.now() + timeout
  while (true) {
    try {
      process.kill(-pid, 0)
    } catch (error) {
      if (noSuchProcess(error)) return true
      // Bun can report EPERM while a terminated detached group is being reaped.
      if (Date.now() >= deadline) throw new Error(`Failed to verify process group ${pid} exited`, { cause: error })
      await scheduler.wait(10)
      continue
    }
    if (Date.now() >= deadline) return false
    await scheduler.wait(10)
  }
}

function signalGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal)
  } catch (error) {
    if (noSuchProcess(error) || permissionDenied(error)) return
    throw new Error(`Failed to signal process group ${pid}`, { cause: error })
  }
}

function noSuchProcess(error: unknown) {
  return typeof error === "object" && error && "code" in error && error.code === "ESRCH"
}

function permissionDenied(error: unknown) {
  return typeof error === "object" && error && "code" in error && error.code === "EPERM"
}

function createOwnership(proc: ChildProcess, timeout: number): Ownership {
  if (!proc.pid) {
    proc.kill("SIGKILL")
    throw new Error("Unable to own process without a PID")
  }
  return { pid: proc.pid, timeout }
}

async function cleanupOwnership(proc: ChildProcess, owner: Ownership) {
  signalGroup(owner.pid, "SIGKILL")
  if (!(await groupExited(owner.pid, owner.timeout))) {
    throw new Error(`Failed to stop process group ${owner.pid}`)
  }
  ownership.delete(proc)
}

function windowsOwnedCommand(cmd: string[]) {
  const payload = Buffer.from(JSON.stringify({ cmd })).toString("base64")
  const helper = process.env.OPENCODE_PROCESS_WIN32_HELPER
  if (helper) {
    if (!path.isAbsolute(helper)) throw new Error("OPENCODE_PROCESS_WIN32_HELPER must be an absolute path")
    return [helper, payload]
  }
  const compiled = path.basename(process.execPath).replace(/\.exe$/, "") !== "bun"
  if (compiled) return [path.join(path.dirname(process.execPath), "opencode-process-win32.exe"), payload]
  return [process.execPath, fileURLToPath(new URL("./process-win32-helper.ts", import.meta.url)), payload]
}

export async function text(cmd: string[], opts: RunOptions = {}): Promise<TextResult> {
  const out = await run(cmd, opts)
  return {
    ...out,
    text: out.stdout.toString(),
  }
}

export async function lines(cmd: string[], opts: RunOptions = {}): Promise<string[]> {
  return (await text(cmd, opts)).text.split(/\r?\n/).filter(Boolean)
}

export * as Process from "./process"
