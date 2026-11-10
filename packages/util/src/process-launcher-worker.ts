// Runs on the launcher thread. Creating a process blocks the thread that asks for it (on Windows, several
// milliseconds each and sometimes over 100), so Windows callers hand launches to this thread. Only Windows:
// elsewhere the in-process spawner also tracks process groups to stop at exit, which this thread does not.
import { exec, type ChildProcess, type StdioOptions } from "node:child_process"
import { accessSync, readlinkSync } from "node:fs"
import path from "node:path"
import type { Readable } from "node:stream"
import { parentPort } from "node:worker_threads"
import launch from "cross-spawn"

interface Launch {
  readonly id: number
  readonly file: string
  readonly args: ReadonlyArray<string>
  readonly cwd?: string
  readonly env?: Record<string, string | undefined>
  readonly shell?: boolean | string
}

/** Run a command to completion and reply once with everything it wrote. */
export interface Run extends Launch {
  readonly type: "run"
  readonly detached?: boolean
  readonly stdin: "ignore" | "pipe" | Uint8Array
  /** Collect stdout and stderr into `stdout`, in arrival order, capped by `maxOutputBytes`. */
  readonly combineOutput: boolean
  readonly maxOutputBytes?: number
  readonly maxErrorBytes?: number
}

/** Start a child with no input and report its output and lifecycle as they happen. */
export interface Spawn extends Launch {
  readonly type: "spawn"
  /** Piped to the caller; otherwise ignored. */
  readonly stdout: boolean
  readonly stderr: boolean
}

export type Request =
  | Run
  | Spawn
  /** Stop a `run` and its process tree. */
  | { readonly type: "cancel"; readonly id: number }
  /** Signal a spawned child, or with `tree` stop its whole process tree and reply `killed`. */
  | { readonly type: "kill"; readonly id: number; readonly signal?: NodeJS.Signals; readonly tree?: boolean }
  /** The caller consumed this many bytes of a spawned child's output. */
  | { readonly type: "ack"; readonly id: number; readonly fd: 1 | 2; readonly bytes: number }
  /** The caller stopped reading a spawned child's output. */
  | { readonly type: "destroy"; readonly id: number; readonly fd: 1 | 2 }

export interface Failure {
  readonly method: "access" | "spawn"
  readonly message: string
  readonly code?: string
  readonly syscall?: string
}

export interface Exited {
  readonly type: "exited"
  readonly id: number
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: Uint8Array
  readonly stderr: Uint8Array
  readonly stdoutTruncated: boolean
  readonly stderrTruncated: boolean
}

export interface Failed {
  readonly type: "failed"
  readonly id: number
  readonly error: Failure
}

export type Reply =
  | Exited
  | Failed
  | { readonly type: "spawned"; readonly id: number; readonly pid: number | undefined }
  | { readonly type: "data"; readonly id: number; readonly fd: 1 | 2; readonly chunk: Uint8Array }
  | { readonly type: "end"; readonly id: number; readonly fd: 1 | 2; readonly error?: string }
  | { readonly type: "exit"; readonly id: number; readonly code: number | null; readonly signal: NodeJS.Signals | null }
  | { readonly type: "close"; readonly id: number; readonly code: number | null; readonly signal: NodeJS.Signals | null }
  | { readonly type: "error"; readonly id: number; readonly error: Failure }
  | { readonly type: "killed"; readonly id: number; readonly error?: string }

/**
 * Output a spawned child may have in flight to the caller before this thread stops reading its pipe. The pipe then
 * fills and the child waits, as it does when an in-process reader falls behind.
 */
const WINDOW = 1024 * 1024

const port = parentPort!
const post = (reply: Reply, transfer: ArrayBuffer[] = []) => port.postMessage(reply, transfer)
const cancels = new Map<number, () => void>()
const children = new Map<number, { child: ChildProcess; flows: Map<1 | 2, { stream: Readable; outstanding: number }> }>()

// Same rule as the in-process collector: keep reading to the end, retain only the first `max` bytes.
const collector = (max: number | undefined) => {
  const chunks: Uint8Array[] = []
  let bytes = 0
  return {
    push: (chunk: Uint8Array) => {
      const remaining = max === undefined ? chunk.length : max - bytes
      if (remaining > 0) chunks.push(remaining >= chunk.length ? chunk : chunk.subarray(0, remaining))
      bytes += chunk.length
    },
    // An exact-size buffer of its own, so it can be transferred instead of copied.
    done: () => {
      const data = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0))
      chunks.reduce((offset, chunk) => {
        data.set(chunk, offset)
        return offset + chunk.length
      }, 0)
      return { data, truncated: max !== undefined && bytes > max }
    },
  }
}

// See `executable` in cross-spawn-spawner.ts: launch the target of a Microsoft Store app execution alias.
const executable = (file: string) => {
  if (process.platform !== "win32" || !path.isAbsolute(file)) return file
  try {
    return path.resolve(path.dirname(file), readlinkSync(file))
  } catch {
    return file
  }
}

const failure = (method: Failure["method"], error: NodeJS.ErrnoException): Failure => ({
  method,
  message: error.message,
  code: error.code,
  syscall: error.syscall,
})

const pipe = process.platform === "win32" ? "overlapped" : "pipe"

function start(request: Launch, stdio: ReadonlyArray<"ignore" | typeof pipe>, detached: boolean) {
  try {
    if (request.cwd !== undefined) accessSync(request.cwd)
  } catch (error) {
    return failure("access", error as NodeJS.ErrnoException)
  }
  try {
    return launch(executable(request.file), [...request.args], {
      cwd: request.cwd === undefined ? undefined : path.resolve(request.cwd),
      env: request.env,
      stdio: [...stdio] as StdioOptions,
      detached,
      shell: request.shell,
      windowsHide: process.platform === "win32",
    })
  } catch (error) {
    return failure("spawn", error as NodeJS.ErrnoException)
  }
}

const killTree = (child: ChildProcess, done: (error: Error | null) => void) =>
  exec(`taskkill /pid ${child.pid} /T /F`, { windowsHide: true }, done)

function run(request: Run) {
  const reply = (message: Exited | Failed, transfer: ArrayBuffer[] = []) => {
    cancels.delete(request.id)
    post(message, transfer)
  }
  const child = start(request, [request.stdin === "ignore" ? "ignore" : pipe, pipe, pipe], request.detached ?? false)
  if ("method" in child) return reply({ type: "failed", id: request.id, error: child })

  const out = collector(request.maxOutputBytes)
  const err = request.combineOutput ? out : collector(request.maxErrorBytes)
  let settled = false
  let exit: readonly [number | null, NodeJS.Signals | null] | undefined
  let deadline: ReturnType<typeof setTimeout> | undefined
  const settle = (code: number | null, signal: NodeJS.Signals | null) => {
    if (settled) return
    settled = true
    clearTimeout(deadline)
    const stdout = out.done()
    const stderr = request.combineOutput ? { data: new Uint8Array(0), truncated: false } : err.done()
    reply(
      {
        type: "exited",
        id: request.id,
        code,
        signal,
        stdout: stdout.data,
        stderr: stderr.data,
        stdoutTruncated: stdout.truncated,
        stderrTruncated: stderr.truncated,
      },
      [stdout.data.buffer, stderr.data.buffer],
    )
  }

  child.stdout?.on("data", out.push).on("error", () => {})
  child.stderr?.on("data", err.push).on("error", () => {})
  child.once("error", (error) => {
    if (settled) return
    settled = true
    clearTimeout(deadline)
    reply({ type: "failed", id: request.id, error: failure("spawn", error) })
  })
  child.once("exit", (code, signal) => {
    exit = [code, signal]
    // A detached descendant holding the pipes can keep "close" from ever firing. Same deadline as the in-process
    // spawner: one second after exit, stop reading and report what arrived.
    deadline = setTimeout(() => {
      child.stdout?.destroy()
      child.stderr?.destroy()
      settle(code, signal)
    }, 1000)
  })
  child.once("close", (code, signal) => settle(exit ? exit[0] : code, exit ? exit[1] : signal))

  if (request.stdin instanceof Uint8Array && child.stdin) {
    // A child that exits without reading must not turn a failed write into an uncaught error.
    child.stdin.on("error", () => {})
    child.stdin.end(request.stdin)
  }

  cancels.set(request.id, () => {
    if (settled || child.pid === undefined) return
    // The whole tree, as the in-process spawner does on Windows.
    killTree(child, (error) => {
      if (error) child.kill()
    })
    // The caller waits for this reply before it finishes interrupting; never leave it waiting on a child that
    // cannot be stopped.
    setTimeout(() => settle(null, "SIGKILL"), 5000).unref()
  })
}

function spawn(request: Spawn) {
  const id = request.id
  const child = start(request, ["ignore", request.stdout ? pipe : "ignore", request.stderr ? pipe : "ignore"], false)
  if ("method" in child) return post({ type: "error", id, error: child })

  const flows = new Map<1 | 2, { stream: Readable; outstanding: number }>()
  const forward = (fd: 1 | 2, stream: Readable | null) => {
    if (!stream) return
    const flow = { stream, outstanding: 0 }
    flows.set(fd, flow)
    stream.on("data", (data: Uint8Array) => {
      // A copy with a buffer of its own: the chunk may share its buffer with others, and a transfer detaches it.
      const chunk = new Uint8Array(data)
      post({ type: "data", id, fd, chunk }, [chunk.buffer])
      flow.outstanding += chunk.length
      if (flow.outstanding >= WINDOW) stream.pause()
    })
    stream.once("end", () => post({ type: "end", id, fd }))
    stream.once("error", (error) => post({ type: "end", id, fd, error: error.message }))
  }
  forward(1, child.stdout)
  forward(2, child.stderr)
  children.set(id, { child, flows })

  child.once("spawn", () => post({ type: "spawned", id, pid: child.pid }))
  child.on("error", (error) => {
    // A child that never started has no "close" to wait for.
    if (child.pid === undefined) children.delete(id)
    post({ type: "error", id, error: failure("spawn", error) })
  })
  child.once("exit", (code, signal) => post({ type: "exit", id, code, signal }))
  child.once("close", (code, signal) => {
    children.delete(id)
    post({ type: "close", id, code, signal })
  })
}

port.on("message", (message: Request) => {
  if (message.type === "run") return run(message)
  if (message.type === "spawn") return spawn(message)
  if (message.type === "cancel") return cancels.get(message.id)?.()
  const entry = children.get(message.id)
  if (message.type === "kill") {
    if (!message.tree) return void entry?.child.kill(message.signal)
    if (!entry) return post({ type: "killed", id: message.id, error: "The process is not running" })
    return void killTree(entry.child, (error) => post({ type: "killed", id: message.id, error: error?.message }))
  }
  const flow = entry?.flows.get(message.fd)
  if (!flow) return
  if (message.type === "destroy") return void flow.stream.destroy()
  flow.outstanding -= message.bytes
  if (flow.outstanding < WINDOW) flow.stream.resume()
})
port.postMessage("ready")
