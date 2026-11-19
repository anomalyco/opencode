import { Environment } from "@opencode/core/environment/index"
import { Machine } from "@opencode/core/machine/index"
import { Cause, Effect, Fiber, Queue, Stream } from "effect"

/** A process the fake worker ran. The test decides what it prints and when it exits. */
export interface Run {
  readonly id: string
  readonly pid: number
  readonly argv: ReadonlyArray<string>
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
  readonly print: (output: string | Uint8Array) => Effect.Effect<void>
  readonly exit: (code: number) => Effect.Effect<void>
}

interface Process {
  readonly run: Run
  output: Uint8Array
  ended?: { readonly code: number } | { readonly code: null; readonly signal: string }
  /** Bytes sent on the current connection; absent when not attached. */
  sent?: number
}

interface Link {
  open: boolean
  readonly queue: Queue.Queue<Machine.FromWorker, Cause.Done>
  fiber?: Fiber.Fiber<void>
}

type Direction = "home" | "worker"

/**
 * A worker in memory that keeps the worker's rules: files on a memory driver, scripted processes, and controls to
 * cut and restore the connection, drop the next message of a type heading either way, and restart.
 */
export const makeWorker = (machine: Machine.Interface, name = "gpu") => {
  const files = Environment.makeMemoryDriver()
  const fs = Environment.makeFiles(files)
  const runs: Run[] = []
  const drops: Array<{ readonly direction: Direction; readonly type: string }> = []
  let instance = crypto.randomUUID()
  let table = new Map<string, Process>()
  let link: Link | undefined

  const dropped = (direction: Direction, type: string) => {
    const index = drops.findIndex((drop) => drop.direction === direction && drop.type === type)
    if (index !== -1) drops.splice(index, 1)
    return index !== -1
  }

  const emit = (message: Machine.FromWorker) =>
    Effect.suspend(() => {
      if (!link?.open || dropped("home", message.type)) return Effect.void
      return Queue.offer(link.queue, message).pipe(Effect.asVoid)
    })

  // Sends what an attachment has not seen, then the exit once everything is sent.
  const flush = (process: Process) =>
    Effect.gen(function* () {
      if (process.sent === undefined) return
      const from = process.sent
      process.sent = process.output.length
      if (process.output.length > from)
        yield* emit({ type: "output", id: process.run.id, offset: from, data: process.output.subarray(from) })
      if (!process.ended) return
      process.sent = undefined
      yield* emit({ type: "exit", id: process.run.id, bytes: process.output.length, ...process.ended })
    })

  const start = (message: Extract<Machine.ToWorker, { type: "start" }>) =>
    Effect.gen(function* () {
      if (table.has(message.id)) return yield* emit({ type: "failed", id: message.id, message: "exists" })
      const process: Process = {
        output: new Uint8Array(),
        sent: 0,
        run: {
          id: message.id,
          pid: 1000 + runs.length,
          argv: message.argv,
          cwd: message.cwd,
          env: message.env,
          print: (output) =>
            Effect.suspend(() => {
              const bytes = typeof output === "string" ? new TextEncoder().encode(output) : output
              const next = new Uint8Array(process.output.length + bytes.length)
              next.set(process.output)
              next.set(bytes, process.output.length)
              process.output = next
              return flush(process)
            }),
          exit: (code) =>
            Effect.suspend(() => {
              process.ended = { code }
              return flush(process)
            }),
        },
      }
      table.set(message.id, process)
      runs.push(process.run)
      yield* emit({ type: "started", id: message.id, pid: process.run.pid })
    })

  const answer = (
    message: Machine.FileCall,
  ): Effect.Effect<
    Extract<Machine.FromWorker, { ok: true }>["result"],
    Environment.NotFound | Environment.WrongKind | Environment.Failed
  > => {
    switch (message.call) {
      case "stat":
        return fs.stat(message.path)
      case "list":
        return fs.list(message.path)
      case "read":
        return fs.read(message.path, message.range)
      case "write":
        return fs.write(message.path, message.bytes).pipe(Effect.as(null))
      case "append":
        return fs.append(message.path, message.bytes).pipe(Effect.as(null))
      case "remove":
        return fs.remove(message.path).pipe(Effect.as(null))
      case "mkdir":
        return fs.mkdir(message.path).pipe(Effect.as(null))
      case "move":
        return fs.move(message.from, message.to).pipe(Effect.as(null))
    }
  }

  const receive = (message: Machine.ToWorker) =>
    Effect.gen(function* () {
      if (dropped("worker", message.type)) return
      if (message.type === "start") return yield* start(message)
      if (message.type === "fs")
        return yield* answer(message).pipe(
          Effect.match({
            onSuccess: (result): Machine.FromWorker => ({ type: "fs", req: message.req, ok: true, result }),
            onFailure: (error): Machine.FromWorker => ({
              type: "fs",
              req: message.req,
              ok: false,
              error:
                error._tag === "Environment.NotFound"
                  ? { kind: "not_found", message: error.message }
                  : error._tag === "Environment.WrongKind"
                    ? { kind: "wrong_kind", message: error.message, actual: error.actual }
                    : { kind: "failed", message: String(error.cause) },
            }),
          }),
          Effect.flatMap(emit),
        )
      const process = table.get(message.id)
      if (!process) return yield* emit({ type: "failed", id: message.id, message: "unknown process" })
      if (message.type === "attach") process.sent = message.from
      if (message.type === "kill") process.ended ??= { code: null, signal: message.signal }
      yield* flush(process)
    })

  const cut = Effect.gen(function* () {
    if (!link) return
    const current = link
    link = undefined
    current.open = false
    // Attachments end with the connection; what was already sent still arrives.
    table.forEach((process) => (process.sent = undefined))
    yield* Queue.end(current.queue)
    if (current.fiber) yield* Fiber.join(current.fiber)
  })

  const restore = Effect.gen(function* () {
    yield* cut
    const current: Link = { open: true, queue: yield* Queue.unbounded<Machine.FromWorker, Cause.Done>() }
    const hello: Machine.Hello = {
      type: "hello",
      name,
      os: "linux",
      arch: "x64",
      instance,
      processes: [...table.values()].map((process) => ({
        id: process.run.id,
        pid: process.run.pid,
        bytes: process.output.length,
        ...(process.ended ? { state: "exited" as const, ...process.ended } : { state: "running" as const }),
      })),
    }
    // Live before the machine sees the hello, so what it sends while handling the hello is answered.
    link = current
    current.fiber = yield* Effect.forkDetach(
      machine.connect({
        hello,
        send: (message) => Effect.suspend(() => (current.open ? receive(message) : Effect.void)),
        messages: Stream.fromQueue(current.queue),
      }),
      { startImmediately: true },
    )
  })

  return {
    files,
    runs,
    cut,
    restore,
    /** A new worker process: new instance, no processes, then it dials in again. */
    restart: Effect.gen(function* () {
      yield* cut
      instance = crypto.randomUUID()
      table = new Map()
      yield* restore
    }),
    /** Drops the next message of `type` heading to `direction`. */
    drop: (direction: Direction, type: string) => drops.push({ direction, type }),
  }
}
