import { Environment } from "@opencode/core/environment/index"
import { Machine } from "@opencode/core/machine/index"
import { Cause, Deferred, Effect, Fiber, Queue, Schema, Stream } from "effect"

/** A process the fake worker ran. The test decides what it prints and when it exits. */
export interface Run {
  readonly id: Machine.ProcessID
  readonly pid: number
  readonly argv: ReadonlyArray<string>
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
  /** Signals the process ignores. */
  readonly traps: Set<string>
  readonly input: Uint8Array[]
  /** Settles after the first accepted stdin request has been recorded. */
  readonly inputReceived: Deferred.Deferred<void>
  inputClosed: boolean
  readonly print: (output: string | Uint8Array, stream?: "stderr") => Effect.Effect<void>
  readonly exit: (code: number) => Effect.Effect<void>
}

interface Process {
  readonly run: Run
  output: Uint8Array
  chunks: Array<{ offset: number; data: Uint8Array; stream: "stdout" | "stderr" }>
  ended?: { readonly code: number } | { readonly code: null; readonly signal: string }
  /** Bytes sent on the current connection; absent when not attached. */
  sent?: number
}

type Message = Exclude<Machine.FromWorker, Machine.Hello>

interface Link {
  open: boolean
  readonly queue: Queue.Queue<Message, Cause.Done>
  fiber?: Fiber.Fiber<void, unknown>
}

type Direction = "home" | "worker"

type Answer = (failure?: string) => void

/**
 * The network between fake workers: a link is up once one worker accepted it and the other dialled it, and a file a
 * worker sends lands in the files of the worker that holds the token's receive.
 */
export const makePeers = () => ({
  waiting: new Map<Machine.PeerLink, Answer>(),
  receives: new Map<
    string,
    {
      readonly link: Machine.PeerLink
      readonly path: string
      readonly files: Environment.Files
      readonly answer: Answer
    }
  >(),
  allows: new Map<string, { readonly link: Machine.PeerLink; readonly port: number }>(),
  forwards: new Map<string, { readonly link: Machine.PeerLink; readonly port: number }>(),
})
export type Peers = ReturnType<typeof makePeers>

/**
 * A worker in memory that keeps the worker's rules: files on a memory driver, scripted processes, and controls to
 * cut, restore and redial the connection, drop the next message of a type heading either way, and restart. Its
 * connections are served in the caller's scope. `system` is what its hello says it runs on.
 */
export const makeWorker = (
  host: {
    readonly connect: (connection: Machine.Connection) => Effect.Effect<void, unknown>
  },
  peers = makePeers(),
  system: Pick<Machine.Hello, "os" | "home" | "shell"> = { os: "linux", home: "/home/worker" },
) =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope
    const files = Environment.makeMemoryDriver()
    const fs = Environment.makeFiles(files)
    const runs: Run[] = []
    /** Every message that reached the worker. */
    const received: Machine.ToWorker[] = []
    const drops: Array<{ readonly direction: Direction; readonly type: string }> = []
    let instance = Machine.Instance.make(crypto.randomUUID())
    let table = new Map<Machine.ProcessID, Process>()
    /** Processes the next hello still lists, then forgets before the home can attach. */
    const forgetting = new Set<Machine.ProcessID>()
    let link: Link | undefined
    /** Peer links that are up. Like the worker's, they outlive its connection to the home. */
    let up = new Set<Machine.PeerLink>()

    const dropped = (direction: Direction, type: string) => {
      const index = drops.findIndex((drop) => drop.direction === direction && drop.type === type)
      if (index !== -1) drops.splice(index, 1)
      return index !== -1
    }

    const emit = (message: Message) => {
      if (link?.open && !dropped("home", message.type)) Queue.offerUnsafe(link.queue, message)
    }

    // Sends what an attachment has not seen, then the exit once everything is sent.
    const flush = (process: Process) => {
      if (process.sent === undefined) return
      const from = process.sent
      process.sent = process.output.length
      for (const chunk of process.chunks) {
        if (chunk.offset + chunk.data.length <= from) continue
        const skip = Math.max(0, from - chunk.offset)
        emit({
          type: "output",
          id: process.run.id,
          ...chunk,
          offset: chunk.offset + skip,
          data: chunk.data.subarray(skip),
        })
      }
      if (!process.ended) return
      process.sent = undefined
      emit({ type: "exit", id: process.run.id, bytes: process.output.length, ...process.ended })
    }

    const start = (message: Extract<Machine.ToWorker, { type: "start" }>) => {
      if (table.has(message.id)) return emit({ type: "failed", id: message.id, request: "start", message: "exists" })
      const process: Process = {
        output: new Uint8Array(),
        chunks: [],
        sent: 0,
        run: {
          id: message.id,
          pid: 1000 + runs.length,
          argv: message.argv,
          cwd: message.cwd,
          env: message.env,
          traps: new Set(),
          input: [],
          inputReceived: Deferred.makeUnsafe(),
          inputClosed: !message.stdin,
          print: (output, stream) =>
            Effect.sync(() => {
              const bytes = typeof output === "string" ? new TextEncoder().encode(output) : output
              process.chunks.push({ offset: process.output.length, data: bytes, stream: stream ?? "stdout" })
              const next = new Uint8Array(process.output.length + bytes.length)
              next.set(process.output)
              next.set(bytes, process.output.length)
              process.output = next
              flush(process)
            }),
          exit: (code) =>
            Effect.sync(() => {
              process.ended = { code }
              flush(process)
            }),
        },
      }
      table.set(message.id, process)
      runs.push(process.run)
      emit({ type: "started", id: message.id, pid: process.run.pid })
    }

    const answer = (
      message: Machine.FileCall,
    ): Effect.Effect<
      Extract<Machine.FromWorker, { type: "fs"; ok: true }>["result"],
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

    const peer = (message: Machine.PeerCall) => {
      const answer: Answer = (failure) =>
        emit(
          failure === undefined
            ? { type: "peer", req: message.req, ok: true }
            : { type: "peer", req: message.req, ok: false, message: failure },
        )
      switch (message.type) {
        case "peer-accept":
        case "peer-connect": {
          up.add(message.link)
          const other = peers.waiting.get(message.link)
          if (!other) return peers.waiting.set(message.link, answer)
          peers.waiting.delete(message.link)
          other()
          return answer()
        }
        case "peer-receive":
          return peers.receives.set(message.token, { link: message.link, path: message.path, files: fs, answer })
        case "peer-send": {
          const grant = peers.receives.get(message.token)
          if (!grant || grant.link !== message.link) return answer("unknown token")
          peers.receives.delete(message.token)
          return Effect.runSync(
            fs.read(message.path).pipe(
              Effect.flatMap((file) => grant.files.write(grant.path, file.bytes)),
              Effect.match({
                onSuccess: () => {
                  grant.answer()
                  answer()
                },
                onFailure: (error) => {
                  grant.answer(error.message)
                  answer(error.message)
                },
              }),
            ),
          )
        }
        case "peer-allow":
          peers.allows.set(message.token, { link: message.link, port: message.port })
          return answer()
        case "peer-forward":
          peers.forwards.set(message.token, { link: message.link, port: message.port })
          return answer()
        case "peer-revoke":
          peers.receives.get(message.token)?.answer("revoked")
          peers.receives.delete(message.token)
          peers.allows.delete(message.token)
          peers.forwards.delete(message.token)
          return answer()
        case "peer-close":
          up.delete(message.link)
          answer()
          return emit({ type: "peer-closed", link: message.link })
      }
    }

    const receive = (message: Machine.ToWorker) => {
      if (dropped("worker", message.type)) return
      received.push(message)
      if (message.type === "start") return start(message)
      if (Schema.is(Machine.PeerCall)(message)) return peer(message)
      if (message.type === "update") return
      if (message.type === "fs")
        return emit(
          // The memory driver answers synchronously.
          Effect.runSync(
            answer(message).pipe(
              Effect.match({
                onSuccess: (result): Message => ({ type: "fs", req: message.req, ok: true, result }),
                onFailure: (error): Message => ({
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
            ),
          ),
        )
      if (message.type === "release") {
        table.delete(message.id)
        return
      }
      const process = table.get(message.id)
      if (message.type === "stdin") {
        if (!process || process.run.inputClosed || process.ended)
          return emit({ type: "stdin", id: message.id, req: message.req, ok: false, message: "Broken pipe" })
        if (message.data === null) process.run.inputClosed = true
        else process.run.input.push(message.data)
        emit({ type: "stdin", id: message.id, req: message.req, ok: true })
        Deferred.doneUnsafe(process.run.inputReceived, Effect.void)
        return
      }
      if (!process) return emit({ type: "failed", id: message.id, request: message.type, message: "unknown process" })
      if (message.type === "kill" && process.ended)
        return emit({ type: "failed", id: message.id, request: "kill", message: "already exited" })
      if (message.type === "attach") process.sent = message.from
      if (message.type === "kill" && !process.run.traps.has(message.signal))
        process.ended = { code: null, signal: message.signal }
      flush(process)
    }

    // The worker stops using its connection, and its attachments end with it.
    const leave = () => {
      const current = link
      link = undefined
      if (current) current.open = false
      table.forEach((process) => (process.sent = undefined))
      return current
    }

    // The home sees the connection close; what was already sent still arrives.
    const close = (current: Link | undefined) =>
      Effect.gen(function* () {
        if (!current) return
        Queue.endUnsafe(current.queue)
        if (current.fiber) yield* Fiber.join(current.fiber)
      })

    const cut = Effect.suspend(() => close(leave()))

    const dial = Effect.gen(function* () {
      const current: Link = { open: true, queue: yield* Queue.unbounded<Message, Cause.Done>() }
      const hello: Machine.Hello = {
        type: "hello",
        protocol: 3,
        ...system,
        arch: "x64",
        instance,
        processes: [...table.values()].map((process) => ({
          id: process.run.id,
          pid: process.run.pid,
          bytes: process.output.length,
          ...(process.ended ? { state: "exited" as const, ...process.ended } : { state: "running" as const }),
        })),
        ...(up.size > 0 ? { links: [...up] } : {}),
      }
      forgetting.forEach((processID) => table.delete(processID))
      forgetting.clear()
      // Live before the machine sees the hello, so what it sends while handling the hello is answered.
      link = current
      current.fiber = yield* Effect.forkIn(
        host.connect({
          hello,
          send: (message) => {
            if (current.open) receive(message)
          },
          messages: Stream.fromQueue(current.queue),
        }),
        scope,
        { startImmediately: true },
      )
    })

    return {
      files,
      runs,
      received,
      cut,
      restore: Effect.andThen(cut, dial),
      /** Dials again before the home notices the old connection is gone. Returns what closes the old one. */
      redial: Effect.suspend(() => {
        const old = leave()
        return Effect.as(dial, close(old))
      }),
      /** A new worker process: new instance, no processes, then it dials in again. */
      restart: Effect.gen(function* () {
        yield* cut
        instance = Machine.Instance.make(crypto.randomUUID())
        table = new Map()
        up = new Set()
        yield* dial
      }),
      /** Forgets a process, as a worker may once it has run a while. */
      forget: (processID: Machine.ProcessID) => table.delete(processID),
      /** Forgets a process after listing it in the next hello, before the home can attach to it. */
      forgetAfterHello: (processID: Machine.ProcessID) => forgetting.add(processID),
      /** Drops the next message of `type` heading to `direction`. */
      drop: (direction: Direction, type: string) => drops.push({ direction, type }),
    }
  })
