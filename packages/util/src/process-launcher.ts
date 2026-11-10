export * as ProcessLauncher from "./process-launcher.js"

import { EventEmitter } from "node:events"
import type { ChildProcess } from "node:child_process"
import { PassThrough } from "node:stream"
import type { Worker } from "node:worker_threads"
import { Context, Effect } from "effect"
import type { Exited, Failed, Reply, Request, Run, Spawn } from "./process-launcher-worker.js"
import { Teardown } from "./teardown.js"

/**
 * Whether a child is created on the launcher thread instead of the calling thread. Only Windows acts on it: there,
 * creating a process costs the calling thread several milliseconds and occasionally over 100, during which a server
 * cannot answer requests. Off unless a caller provides it; Core's Snapshot and Shell do, from the `process_launcher`
 * flag.
 */
export const Enabled = Context.Reference<boolean>("@opencode/ProcessLauncher/Enabled", {
  defaultValue: () => false,
})

/** How much consumed output accumulates before the launcher thread is told, so one message covers many chunks. */
const ACK = 256 * 1024

// One launcher thread per process. Its messages are routed to callers by request ID.
type Message = Reply | { readonly type: "lost"; readonly id: number }
const handlers = new Map<number, (message: Message) => void>()
let next = 0
let active = 0
let started: Promise<Worker | undefined> | undefined

// Ref'd only while a child is running, so an idle launcher never holds the process open.
const retain = (worker: Worker) => {
  if (active++ === 0) worker.ref()
}
const release = (worker: Worker) => {
  if (--active === 0) worker.unref()
}

async function start(url?: URL) {
  const { Worker } = await import("node:worker_threads")
  const worker = new Worker(url ?? new URL("./process-launcher-worker.js", import.meta.url))
  const ready = await new Promise<boolean>((resolve) => {
    worker.once("message", () => resolve(true))
    worker.once("error", () => resolve(false))
    worker.once("exit", () => resolve(false))
  })
  if (!ready) {
    void worker.terminate()
    return undefined
  }
  // Children in flight fail the way a child that could not start does; later launches run in-process.
  const lost = () => {
    started = Promise.resolve(undefined)
    Array.from(handlers).forEach(([id, handler]) => handler({ type: "lost", id }))
  }
  worker
    .on("message", (reply: Reply) => handlers.get(reply.id)?.(reply))
    .once("error", lost)
    .once("exit", lost)
  worker.unref()
  return worker
}

/**
 * The launcher thread, started on first use. `undefined` where it cannot start (no worker threads, or a bundle
 * without the worker entry), and from then on once it has stopped.
 */
export const thread = (url?: URL) => Effect.promise(() => (started ??= start(url).catch(() => undefined)))

/**
 * Run one command to completion on the launcher thread. Interrupting the effect stops the child's process tree and
 * waits for it, as closing an in-process child's scope does.
 */
export const run = (worker: Worker, request: Omit<Run, "id" | "type">, label: string) =>
  Effect.callback<Exited | Failed>((resume) => {
    const id = next++
    const settle = Teardown.track(`child running: ${label.slice(0, 200)}`)
    const finish = () => {
      handlers.delete(id)
      settle()
      release(worker)
    }
    const reply = (message: Message): Exited | Failed | undefined => {
      if (message.type === "exited" || message.type === "failed") return message
      if (message.type !== "lost") return undefined
      return { type: "failed", id, error: { method: "spawn", message: "The process launcher thread stopped" } }
    }
    handlers.set(id, (message) => {
      const result = reply(message)
      if (!result) return
      finish()
      resume(Effect.succeed(result))
    })
    retain(worker)
    worker.postMessage({ ...request, type: "run", id } satisfies Request)
    return Effect.callback<void>((stopped) => {
      if (!handlers.has(id)) return stopped(Effect.void)
      handlers.set(id, (message) => {
        if (!reply(message)) return
        finish()
        stopped(Effect.void)
      })
      worker.postMessage({ type: "cancel", id } satisfies Request)
    })
  })

/**
 * A child running on the launcher thread, with the part of `ChildProcess` the spawner uses: the lifecycle events, the
 * pid, piped stdout and stderr, and kill. It has no stdin.
 */
export class RemoteChild extends EventEmitter {
  pid: number | undefined = undefined
  readonly stdin = null
  readonly stdout: PassThrough | null
  readonly stderr: PassThrough | null
  readonly stdio: ChildProcess["stdio"]
  readonly #worker: Worker
  readonly #id = next++
  readonly #unacked = { 1: 0, 2: 0 }
  readonly #draining = { 1: false, 2: false }
  readonly #ended = { 1: false, 2: false }
  readonly #kills: Array<(error?: Error) => void> = []
  #retained = true
  #closed = false

  constructor(worker: Worker, request: Omit<Spawn, "id" | "type">) {
    super()
    this.#worker = worker
    this.stdout = request.stdout ? this.#output(1) : null
    this.stderr = request.stderr ? this.#output(2) : null
    this.stdio = [null, this.stdout, this.stderr, undefined, undefined]
    handlers.set(this.#id, (message) => this.#receive(message))
    retain(worker)
    this.#post({ ...request, type: "spawn", id: this.#id })
  }

  kill(signal?: NodeJS.Signals) {
    if (this.#closed) return false
    this.#post({ type: "kill", id: this.#id, signal })
    return true
  }

  /** Stop the child's whole process tree; `done` receives the failure, if any. */
  killTree(done: (error?: Error) => void) {
    if (this.#closed) return done(new Error("The process is not running"))
    this.#kills.push(done)
    this.#post({ type: "kill", id: this.#id, tree: true })
  }

  ref() {
    if (this.#retained || this.#closed) return
    this.#retained = true
    retain(this.#worker)
  }

  unref() {
    if (!this.#retained) return
    this.#retained = false
    release(this.#worker)
  }

  #post(request: Request) {
    this.#worker.postMessage(request)
  }

  #output(fd: 1 | 2) {
    // Room for a batch of chunks, so a reader that keeps up costs one acknowledgement per batch, not one per chunk.
    const stream = new PassThrough({ highWaterMark: ACK })
    // Destroying this end stops the launcher thread reading the pipe, as destroying the real stream would.
    stream.once("close", () => {
      if (!this.#ended[fd] && !this.#closed) this.#post({ type: "destroy", id: this.#id, fd })
    })
    return stream
  }

  // Consumed bytes are acknowledged, so the launcher thread stops reading the pipe while this side is behind.
  #write(fd: 1 | 2, chunk: Uint8Array) {
    const stream = fd === 1 ? this.stdout : this.stderr
    this.#unacked[fd] += chunk.length
    if (!stream || stream.destroyed || stream.writableEnded) return this.#ack(fd)
    if (stream.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength))) {
      if (!this.#draining[fd] && this.#unacked[fd] >= ACK) this.#ack(fd)
      return
    }
    if (this.#draining[fd]) return
    this.#draining[fd] = true
    stream.once("drain", () => {
      this.#draining[fd] = false
      this.#ack(fd)
    })
  }

  #ack(fd: 1 | 2) {
    if (this.#closed) return
    this.#post({ type: "ack", id: this.#id, fd, bytes: this.#unacked[fd] })
    this.#unacked[fd] = 0
  }

  #end(fd: 1 | 2, error?: string) {
    this.#ended[fd] = true
    const stream = fd === 1 ? this.stdout : this.stderr
    if (!stream || stream.destroyed || stream.writableEnded) return
    if (error) return void stream.destroy(new Error(error))
    stream.end()
  }

  #close(code: number | null, signal: NodeJS.Signals | null) {
    if (this.#closed) return
    this.#closed = true
    handlers.delete(this.#id)
    this.#end(1)
    this.#end(2)
    // The child is gone, which is what a pending kill asked for; its own reply would arrive after this.
    this.#kills.splice(0).forEach((done) => done())
    if (this.#retained) release(this.#worker)
    this.#retained = false
    this.emit("close", code, signal)
  }

  #receive(message: Message) {
    switch (message.type) {
      case "spawned":
        this.pid = message.pid
        return void this.emit("spawn")
      case "data":
        return this.#write(message.fd, message.chunk)
      case "end":
        return this.#end(message.fd, message.error)
      case "exit":
        return void this.emit("exit", message.code, message.signal)
      case "close":
        return this.#close(message.code, message.signal)
      case "killed":
        return this.#kills.shift()?.(message.error === undefined ? undefined : new Error(message.error))
      case "error": {
        const error = Object.assign(new Error(message.error.message), {
          code: message.error.code,
          syscall: message.error.syscall,
        })
        this.emit("error", error)
        // A child that never started has no "close" to wait for.
        if (this.pid === undefined) this.#close(null, null)
        return
      }
      case "lost":
        this.emit("error", new Error("The process launcher thread stopped"))
        return this.#close(null, null)
    }
  }
}

/** Start a child with no input on the launcher thread. */
export const spawn = (worker: Worker, request: Omit<Spawn, "id" | "type">) =>
  // The spawner reads only the members RemoteChild implements.
  new RemoteChild(worker, request) as unknown as ChildProcess
