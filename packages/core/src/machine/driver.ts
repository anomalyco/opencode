import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { Cause, Deferred, Effect, PlatformError, Queue, Redacted, Schema, Sink, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { Environment } from "../environment/index.js"
import { Failed, NotFound, WrongKind, type DirEntry, type FileInfo } from "../environment/files.js"
import { Signal, type FileCall, type FromWorker, type Hello, type ToWorker } from "./wire.js"

/** How long a start whose connection was lost waits for the worker to come back before it is reported unknown. */
const START_GRACE = "15 seconds"

export class NotSent extends Schema.TaggedError<NotSent>()("Machine.NotSent", { machine: Environment.ID }) {
  override get message() {
    return `${this.machine} is offline, command not sent`
  }
}

export class Unknown extends Schema.TaggedError<Unknown>()("Machine.Unknown", { machine: Environment.ID }) {
  override get message() {
    return `Lost connection to ${this.machine}. The command may or may not have started.`
  }
}

export class WorkerRestarted extends Schema.TaggedError<WorkerRestarted>()("Machine.WorkerRestarted", {
  machine: Environment.ID,
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
  readonly messages: Stream.Stream<Exclude<FromWorker, Hello>>
}

export interface Interface {
  readonly environment: Environment.Interface
  /**
   * Serves one connection until it is lost. A newer connection replaces it: the one being served counts as lost the
   * moment the newer one arrives, and its end changes nothing after that.
   */
  readonly connect: (connection: Connection) => Effect.Effect<void>
}

interface Link {
  readonly instance: string
  readonly send: Connection["send"]
  readonly lost: Deferred.Deferred<void>
  /** File calls sent on this connection and not yet answered. */
  readonly calls: Map<number, Deferred.Deferred<Extract<FromWorker, { type: "fs" }>, Unknown>>
}

interface Process {
  readonly instance: string
  readonly started: Deferred.Deferred<number, Error>
  readonly output: Queue.Queue<Uint8Array, PlatformError.PlatformError | Cause.Done>
  readonly exited: Deferred.Deferred<Extract<FromWorker, { type: "exit" }>, WorkerRestarted>
  delivered: number
}

type Call = FileCall extends infer M ? (M extends FileCall ? Omit<M, "type" | "req"> : never) : never

/** A machine reached through a worker that dials in: its environment, and where the worker's connections arrive. */
export const make = (id: Environment.ID): Interface => {
  const processes = new Map<string, Process>()
  let link: Link | undefined
  let next = Deferred.makeUnsafe<Link>()
  let req = 0
  const online = Effect.suspend(() => (link ? Effect.succeed(link) : Deferred.await(next)))
  const platform = (method: string) => (cause: Error) =>
    PlatformError.systemError({ _tag: "Unknown", module: "Machine", method, description: cause.message, cause })
  const unsupported = (what: string) =>
    PlatformError.badArgument({ module: "Machine", method: "spawn", description: `${what} not supported on ${id}` })

  // Idempotent, so a replaced connection ending later changes nothing.
  const lose = (current: Link) => {
    if (link === current) link = undefined
    Deferred.doneUnsafe(current.lost, Effect.void)
    current.calls.forEach((call) => Deferred.doneUnsafe(call, Effect.fail(new Unknown({ machine: id }))))
  }

  const connect = (connection: Connection) =>
    Effect.gen(function* () {
      if (link) lose(link)
      const current: Link = {
        instance: connection.hello.instance,
        send: connection.send,
        lost: Deferred.makeUnsafe(),
        calls: new Map(),
      }
      const listed = new Map(connection.hello.processes.map((entry) => [entry.id, entry]))
      for (const [processID, process] of processes) {
        const entry = listed.get(processID)
        if (entry && process.instance === current.instance) {
          // Settles a start whose reply was lost with the last connection.
          Deferred.doneUnsafe(process.started, Effect.succeed(entry.pid))
          yield* current.send({ type: "attach", id: processID, from: process.delivered })
          continue
        }
        processes.delete(processID)
        // A start the same worker does not list never reached it, so a retry is safe. A new worker lost everything.
        Deferred.doneUnsafe(
          process.started,
          Effect.fail(
            process.instance === current.instance ? new NotSent({ machine: id }) : new Unknown({ machine: id }),
          ),
        )
        Deferred.doneUnsafe(process.exited, Effect.fail(new WorkerRestarted({ machine: id })))
        yield* Queue.fail(process.output, platform("output")(new WorkerRestarted({ machine: id })))
      }
      link = current
      Deferred.doneUnsafe(next, Effect.succeed(current))
      next = Deferred.makeUnsafe()
      yield* connection.messages.pipe(
        Stream.interruptWhen(Deferred.await(current.lost)),
        Stream.runForEach((message) => receive(current, message)),
        Effect.ensuring(Effect.sync(() => lose(current))),
      )
    })

  const receive = (current: Link, message: Exclude<FromWorker, Hello>) =>
    Effect.gen(function* () {
      if (message.type === "fs") {
        const call = current.calls.get(message.req)
        if (call) Deferred.doneUnsafe(call, Effect.succeed(message))
        return
      }
      const process = processes.get(message.id)
      if (!process) return
      switch (message.type) {
        case "started":
          Deferred.doneUnsafe(process.started, Effect.succeed(message.pid))
          return
        case "failed":
          // Once started, a failed attach or kill changes nothing the handle reports.
          Deferred.doneUnsafe(process.started, Effect.fail(new Error(message.message)))
          return
        case "output": {
          // A chunk past what was delivered follows a lost one; the exit's byte count attaches again from the gap.
          if (message.offset > process.delivered) return
          const fresh = message.data.subarray(process.delivered - message.offset)
          process.delivered += fresh.length
          if (fresh.length > 0) yield* Queue.offer(process.output, fresh)
          return
        }
        case "exit":
          if (message.bytes > process.delivered)
            return yield* current.send({ type: "attach", id: message.id, from: process.delivered })
          processes.delete(message.id)
          Deferred.doneUnsafe(process.exited, Effect.succeed(message))
          yield* Queue.end(process.output)
      }
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
      if (!live) return yield* platform("spawn")(new NotSent({ machine: id }))

      const processID = crypto.randomUUID()
      const process: Process = {
        instance: live.instance,
        started: Deferred.makeUnsafe(),
        output: yield* Queue.unbounded<Uint8Array, PlatformError.PlatformError | Cause.Done>(),
        exited: Deferred.makeUnsafe(),
        delivered: 0,
      }
      processes.set(processID, process)
      // Like a local process, one that outlives the scope that spawned it is killed, here at best effort.
      yield* Effect.addFinalizer(() =>
        Effect.suspend(() => {
          // Still listed: running, or its start is unanswered.
          if (!processes.delete(processID) || !link) return Effect.void
          return link.send({ type: "kill", id: processID, signal: killSignal })
        }),
      )
      yield* live.send({
        type: "start",
        id: processID,
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
            Effect.andThen(Effect.fail(new Unknown({ machine: id }))),
          ),
        ),
        Effect.tapError(() => Effect.sync(() => processes.delete(processID))),
        Effect.mapError(platform("spawn")),
      )

      // Done once the process is gone. Until then it waits for a connection rather than failing without one, so a
      // stop asked for while the machine is away still reaches the process once it is back.
      const terminate = (signal: ChildProcess.Signal) =>
        Schema.is(Signal)(signal)
          ? Effect.raceFirst(
              Effect.ignore(Deferred.await(process.exited)),
              online.pipe(
                Effect.flatMap((current) => current.send({ type: "kill", id: processID, signal })),
                Effect.andThen(Effect.never),
              ),
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
      const current = link
      if (!current) return Effect.fail(new Failed({ path, cause: new NotSent({ machine: id }) }))
      const callID = ++req
      const reply = Deferred.makeUnsafe<Extract<FromWorker, { type: "fs" }>, Unknown>()
      current.calls.set(callID, reply)
      return current.send({ type: "fs", req: callID, ...request }).pipe(
        Effect.andThen(Deferred.await(reply)),
        Effect.ensuring(Effect.sync(() => current.calls.delete(callID))),
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
    environment: Environment.make(id, {
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
    }),
  }
}

const reveal = (value: string | Redacted.Redacted<string>) =>
  Redacted.isRedacted(value) ? Redacted.value(value) : value

export * as MachineDriver from "./driver.js"
