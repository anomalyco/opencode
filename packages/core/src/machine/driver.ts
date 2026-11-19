import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { Cause, Deferred, Effect, PlatformError, Queue, Redacted, Schema, Sink, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import type { Driver } from "../environment/driver.js"
import { Failed, NotFound, WrongKind, type DirEntry, type FileInfo } from "../environment/files.js"
import { Signal, type FileCall, type FromWorker, type Hello, type ToWorker } from "./wire.js"

/** How long a start whose connection was lost waits for the worker to come back before it is reported unknown. */
const START_GRACE = "15 seconds"

export class NotSent extends Schema.TaggedError<NotSent>()("Machine.NotSent", { machine: Schema.String }) {
  override get message() {
    return `${this.machine} is offline, command not sent`
  }
}

export class Unknown extends Schema.TaggedError<Unknown>()("Machine.Unknown", { machine: Schema.String }) {
  override get message() {
    return `Lost connection to ${this.machine}. The command may or may not have started.`
  }
}

export class WorkerRestarted extends Schema.TaggedError<WorkerRestarted>()("Machine.WorkerRestarted", {
  machine: Schema.String,
}) {
  override get message() {
    return `${this.machine}'s worker restarted, the process was lost`
  }
}

/** One connection from the worker, as the endpoint that accepted it hands it over. */
export interface Connection {
  readonly hello: Hello
  readonly send: (message: ToWorker) => Effect.Effect<void>
  /** The messages after `hello`. Ends when the connection is lost. */
  readonly messages: Stream.Stream<FromWorker>
}

export interface Interface {
  readonly driver: Driver
  /** Serves one connection until it is lost. Connections are served one at a time. */
  readonly connect: (connection: Connection) => Effect.Effect<void>
}

interface Link {
  readonly instance: string
  readonly send: Connection["send"]
  readonly lost: Deferred.Deferred<void>
}

interface Process {
  readonly instance: string
  readonly started: Deferred.Deferred<number, Error>
  readonly output: Queue.Queue<Uint8Array, PlatformError.PlatformError | Cause.Done>
  readonly exited: Deferred.Deferred<Extract<FromWorker, { type: "exit" }>, WorkerRestarted>
  delivered: number
}

type Call = FileCall extends infer M ? (M extends FileCall ? Omit<M, "type" | "req"> : never) : never

/** A machine reached through a worker that dials in: its environment driver, and where its connections arrive. */
export const make = (name: string): Interface => {
  const processes = new Map<string, Process>()
  const calls = new Map<number, Deferred.Deferred<Extract<FromWorker, { type: "fs" }>, Unknown>>()
  let link: Link | undefined
  let next = Deferred.makeUnsafe<Link>()
  let req = 0
  const online = Effect.suspend(() => (link ? Effect.succeed(link) : Deferred.await(next)))
  const platform = (method: string) => (cause: Error) =>
    PlatformError.systemError({ _tag: "Unknown", module: "Machine", method, description: cause.message, cause })
  const unsupported = (what: string) =>
    PlatformError.badArgument({ module: "Machine", method: "spawn", description: `${what} not supported on ${name}` })

  const connect = (connection: Connection) =>
    Effect.gen(function* () {
      const current: Link = { instance: connection.hello.instance, send: connection.send, lost: Deferred.makeUnsafe() }
      const listed = new Map(connection.hello.processes.map((entry) => [entry.id, entry]))
      for (const [id, process] of processes) {
        const entry = listed.get(id)
        if (entry && process.instance === current.instance) {
          // Settles a start whose reply was lost with the last connection.
          Deferred.doneUnsafe(process.started, Effect.succeed(entry.pid))
          yield* current.send({ type: "attach", id, from: process.delivered })
          continue
        }
        processes.delete(id)
        // A start the same worker does not list never reached it, so a retry is safe. A new worker lost everything.
        Deferred.doneUnsafe(
          process.started,
          Effect.fail(
            process.instance === current.instance ? new NotSent({ machine: name }) : new Unknown({ machine: name }),
          ),
        )
        Deferred.doneUnsafe(process.exited, Effect.fail(new WorkerRestarted({ machine: name })))
        yield* Queue.fail(process.output, platform("output")(new WorkerRestarted({ machine: name })))
      }
      link = current
      Deferred.doneUnsafe(next, Effect.succeed(current))
      next = Deferred.makeUnsafe()
      yield* connection.messages.pipe(
        Stream.runForEach((message) => receive(current, message)),
        Effect.ensuring(
          Effect.sync(() => {
            link = undefined
            Deferred.doneUnsafe(current.lost, Effect.void)
            calls.forEach((call) => Deferred.doneUnsafe(call, Effect.fail(new Unknown({ machine: name }))))
          }),
        ),
      )
    })

  const receive = (current: Link, message: FromWorker) =>
    Effect.gen(function* () {
      if (message.type === "hello") return
      if (message.type === "fs") {
        const call = calls.get(message.req)
        if (call) Deferred.doneUnsafe(call, Effect.succeed(message))
        return
      }
      const process = processes.get(message.id)
      if (!process) return
      if (message.type === "started") return void Deferred.doneUnsafe(process.started, Effect.succeed(message.pid))
      // Once started, a failed attach or kill changes nothing the handle reports.
      if (message.type === "failed")
        return void Deferred.doneUnsafe(process.started, Effect.fail(new Error(message.message)))
      if (message.type === "output") {
        // A chunk past what was delivered follows a lost one; the exit's byte count attaches again from the gap.
        if (message.offset > process.delivered) return
        const fresh = message.data.subarray(process.delivered - message.offset)
        process.delivered += fresh.length
        if (fresh.length > 0) yield* Queue.offer(process.output, fresh)
        return
      }
      if (message.bytes > process.delivered)
        return yield* current.send({ type: "attach", id: message.id, from: process.delivered })
      processes.delete(message.id)
      Deferred.doneUnsafe(process.exited, Effect.succeed(message))
      yield* Queue.end(process.output)
    })

  const spawner = ChildProcessSpawner.make((command) =>
    Effect.gen(function* () {
      if (command._tag === "PipedCommand") return yield* unsupported("piped commands are")
      const options = command.options
      const killSignal = options.killSignal ?? "SIGTERM"
      if (options.stdin !== undefined && options.stdin !== "ignore") return yield* unsupported("stdin is")
      if (options.shell) return yield* unsupported("the shell option is")
      if (options.additionalFds) return yield* unsupported("extra file descriptors are")
      if (options.cwd === undefined) return yield* unsupported("a command without a working directory is")
      if (!Schema.is(Signal)(killSignal)) return yield* unsupported(`${killSignal} is`)
      const live = link
      if (!live) return yield* platform("spawn")(new NotSent({ machine: name }))

      const id = crypto.randomUUID()
      const process: Process = {
        instance: live.instance,
        started: Deferred.makeUnsafe(),
        output: yield* Queue.unbounded<Uint8Array, PlatformError.PlatformError | Cause.Done>(),
        exited: Deferred.makeUnsafe(),
        delivered: 0,
      }
      processes.set(id, process)
      // Like a local process, one that outlives the scope that spawned it is killed, here at best effort.
      yield* Effect.addFinalizer(() =>
        Effect.suspend(() => {
          // Still listed: running, or its start is unanswered.
          if (!processes.delete(id) || !link) return Effect.void
          return link.send({ type: "kill", id, signal: killSignal })
        }),
      )
      yield* live.send({
        type: "start",
        id,
        argv: [command.command, ...command.args.map(reveal)],
        cwd: options.cwd,
        // The worker's own environment is the base: the server's never crosses, and an unset cannot be sent.
        env: Object.fromEntries(
          Object.entries(options.env ?? {}).flatMap(([key, value]) =>
            value === undefined ? [] : [[key, reveal(value)]],
          ),
        ),
      })
      const pid = yield* Deferred.await(process.started).pipe(
        Effect.raceFirst(
          Deferred.await(live.lost).pipe(
            Effect.andThen(Effect.sleep(START_GRACE)),
            Effect.andThen(Effect.fail(new Unknown({ machine: name }))),
          ),
        ),
        Effect.tapError(() => Effect.sync(() => processes.delete(id))),
        Effect.mapError(platform("spawn")),
      )

      // Waits for the connection rather than failing without it, so a stop asked for while the machine is away
      // still reaches the process once it is back.
      const terminate = (signal: ChildProcess.Signal) =>
        Schema.is(Signal)(signal)
          ? online.pipe(
              Effect.flatMap((current) => current.send({ type: "kill", id, signal })),
              Effect.andThen(Effect.ignore(Deferred.await(process.exited))),
            )
          : Effect.fail(unsupported(`${signal} is`))
      const all = Stream.fromQueue(process.output)
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(pid),
        exitCode: Deferred.await(process.exited).pipe(
          Effect.mapError(platform("exitCode")),
          Effect.flatMap((exit) =>
            exit.code === null
              ? Effect.fail(platform("exitCode")(new CrossSpawnSpawner.KilledBySignal(exit.signal as NodeJS.Signals)))
              : Effect.succeed(ChildProcessSpawner.ExitCode(exit.code)),
          ),
        ),
        isRunning: Effect.map(Deferred.isDone(process.exited), (done) => !done),
        kill: (options) =>
          options?.forceKillAfter === undefined
            ? terminate(options?.killSignal ?? killSignal)
            : Effect.timeoutOrElse(terminate(options.killSignal ?? killSignal), {
                duration: options.forceKillAfter,
                orElse: () => terminate("SIGKILL"),
              }),
        stdin: Sink.fail(unsupported("stdin is")),
        stdout: all,
        stderr: Stream.empty,
        all,
        getInputFd: () => Sink.fail(unsupported("extra file descriptors are")),
        getOutputFd: () => Stream.fail(unsupported("extra file descriptors are")),
        unref: Effect.succeed(Effect.void),
      })
    }),
  )

  // The worker keeps the `Files` contract: each call is answered with its own result and only the refusals it allows.
  const call = <A, E extends NotFound | WrongKind = never>(path: string, request: Call) =>
    Effect.suspend(() => {
      if (!link) return Effect.fail(new Failed({ path, cause: new NotSent({ machine: name }) }))
      const id = ++req
      const reply = Deferred.makeUnsafe<Extract<FromWorker, { type: "fs" }>, Unknown>()
      calls.set(id, reply)
      return link.send({ type: "fs", req: id, ...request }).pipe(
        Effect.andThen(Deferred.await(reply)),
        Effect.ensuring(Effect.sync(() => calls.delete(id))),
        Effect.mapError((cause) => new Failed({ path, cause })),
      )
    }).pipe(
      Effect.flatMap((reply): Effect.Effect<A, E | Failed> => {
        if (reply.ok) return Effect.succeed(reply.result as A)
        if (reply.error.kind === "not_found") return Effect.fail(new NotFound({ path }) as E)
        if (reply.error.kind === "wrong_kind" && reply.error.actual)
          return Effect.fail(new WrongKind({ path, actual: reply.error.actual }) as E)
        return Effect.fail(new Failed({ path, cause: new Error(reply.error.message) }))
      }),
    )

  return {
    connect,
    driver: {
      spawner,
      overrides: {
        stat: (path) => call<FileInfo, NotFound>(path, { call: "stat", path }),
        list: (path) => call<ReadonlyArray<DirEntry>, NotFound | WrongKind>(path, { call: "list", path }),
        read: (path, range) =>
          call<{ info: FileInfo; bytes: Uint8Array }, NotFound | WrongKind>(path, { call: "read", path, range }),
        write: (path, bytes) => call<void>(path, { call: "write", path, bytes }),
        append: (path, bytes) => call<void>(path, { call: "append", path, bytes }),
        remove: (path) => call<void>(path, { call: "remove", path }),
        mkdir: (path) => call<void>(path, { call: "mkdir", path }),
        move: (from, to) => call<void, NotFound>(from, { call: "move", from, to }),
      },
    },
  }
}

const reveal = (value: string | Redacted.Redacted<string>) =>
  Redacted.isRedacted(value) ? Redacted.value(value) : value

export * as MachineDriver from "./driver.js"
