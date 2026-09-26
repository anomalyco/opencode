import { type ChildProcess } from "child_process"
import type { Stream } from "node:stream"
import launch from "cross-spawn"
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

export function spawn(cmd: string[], opts: Options = {}): Child {
  if (cmd.length === 0) throw new Error("Command is required")
  opts.abort?.throwIfAborted()

  const proc = launch(cmd[0], cmd.slice(1), {
    cwd: opts.cwd,
    shell: opts.shell,
    env: opts.env === null ? {} : opts.env ? { ...process.env, ...opts.env } : undefined,
    stdio: [opts.stdin ?? "ignore", opts.stdout ?? "ignore", opts.stderr ?? "ignore"],
    windowsHide: process.platform === "win32",
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

  const child = proc as Child
  child.exited = exited
  return child
}

// `buffer()` has no ceiling, so a chatty command can exhaust the worker heap. Cap
// collection and append a marker instead; callers that parse the output see the
// marker rather than silently truncated bytes.
export const MAX_OUTPUT_BYTES = 10 * 1024 * 1024
const OUTPUT_TRUNCATED = Buffer.from("\n... [output truncated]")

function readCapped(stream: NodeJS.ReadableStream, limit = MAX_OUTPUT_BYTES): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let truncated = false
    stream.on("data", (chunk: Buffer) => {
      if (truncated) return
      const remaining = limit - size
      if (remaining <= 0) {
        truncated = true
        return
      }
      const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk
      chunks.push(slice)
      size += slice.length
      if (slice.length < chunk.length) truncated = true
    })
    stream.on("end", () => {
      if (truncated) chunks.push(OUTPUT_TRUNCATED)
      resolve(Buffer.concat(chunks))
    })
    stream.on("error", reject)
  })
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
    stdout: "pipe",
    stderr: "pipe",
  })

  if (!proc.stdout || !proc.stderr) throw new Error("Process output not available")

  const out = await Promise.all([proc.exited, readCapped(proc.stdout), readCapped(proc.stderr)])
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
const STOP_ESCALATE_MS = 2_000
const STOP_FINAL_WAIT_MS = 5_000

// Concurrent stop() calls must share one teardown: without this each caller attaches its
// own exit listener and escalation timer and sends its own SIGTERM (v8 NEW-09).
const stopping = new WeakMap<ChildProcess, Promise<void>>()

export async function stop(proc: ChildProcess) {
  const pending = stopping.get(proc)
  if (pending) return pending
  const task = stopProcess(proc)
  stopping.set(proc, task)
  try {
    await task
  } finally {
    if (stopping.get(proc) === task) stopping.delete(proc)
  }
}

async function stopProcess(proc: ChildProcess) {
  if (proc.exitCode !== null || proc.signalCode !== null) return

  if (process.platform === "win32" && proc.pid) {
    const out = await run(["taskkill", "/pid", String(proc.pid), "/T", "/F"], {
      nothrow: true,
    })
    if (out.code === 0) return
    proc.kill()
    return
  }

  let finished = false
  let escalate: ReturnType<typeof setTimeout> | undefined
  let resolveExit: (() => void) | undefined
  const onExit = () => {
    finished = true
    if (escalate) clearTimeout(escalate)
    resolveExit?.()
  }
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve
    proc.once("exit", onExit)
  })
  try {
    proc.kill("SIGTERM")
  } catch {}
  escalate = setTimeout(() => {
    if (finished || proc.exitCode !== null || proc.signalCode !== null) return
    try {
      proc.kill("SIGKILL")
    } catch {}
  }, STOP_ESCALATE_MS)
  let finalWait: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    exited,
    new Promise<void>((resolve) => {
      finalWait = setTimeout(resolve, STOP_FINAL_WAIT_MS)
    }),
  ])
  if (escalate) clearTimeout(escalate)
  if (finalWait) clearTimeout(finalWait)
  // The 5s final wait wins over a hung child, whose `exit` never fires; drop the listener
  // so repeated stop() calls cannot accumulate them or re-arm a SIGKILL per call.
  proc.removeListener("exit", onExit)
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
