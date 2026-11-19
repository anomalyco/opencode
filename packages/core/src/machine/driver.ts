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
  /** Queues the message and returns. A message queued on a connection that is lost is dropped. */
  readonly send: (message: ToWorker) => void
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
  readonly exited: Deferred.Deferred<Extract<FromWorker, { type: "exit" }>, Error>
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

  // The process will not be heard from again: whoever waits on it gets `error`.
  const gone = (processID: string, process: Process, error: Error) => {
    processes.delete(processID)
    Deferred.doneUnsafe(process.started, Effect.fail(error))
    Deferred.doneUnsafe(process.exited, Effect.fail(error))
    Queue.failCauseUnsafe(process.output, Cause.fail(platform("output")(error)))
  }

  const connect = (connection: Connection) =>
    Effect.suspend(() => {
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
          current.send({ type: "attach", id: processID, from: process.delivered })
          continue
        }
        // A start the same worker does not list never reached it, so a retry is safe. A new worker lost everything.
        gone(
          processID,
          process,
          Deferred.isDoneUnsafe(process.started)
            ? new WorkerRestarted({ machine: id })
            : process.instance === current.instance
              ? new NotSent({ machine: id })
              : new Unknown({ machine: id }),
        )
      }
      link = current
      Deferred.doneUnsafe(next, Effect.succeed(current))
      next = Deferred.makeUnsafe()
      return connection.messages.pipe(
        Stream.interruptWhen(Deferred.await(current.lost)),
        Stream.runForEach((message) => Effect.sync(() => receive(current, message))),
        Effect.ensuring(Effect.sync(() => lose(current))),
      )
    })

  const receive = (current: Link, message: Exclude<FromWorker, Hello>) => {
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
        // A refused start never ran. Once started, a failed attach or kill changes nothing the handle reports.
        if (!Deferred.isDoneUnsafe(process.started)) gone(message.id, process, new Error(message.message))
        return
      case "output": {
        // A chunk past what was delivered follows a lost one; the exit's byte count attaches again from the gap.
        if (message.offset > process.delivered) return
        const fresh = message.data.subarray(process.delivered - message.offset)
        process.delivered += fresh.length
        if (fresh.length > 0) Queue.offerUnsafe(process.output, fresh)
        return
      }
      case "exit":
        if (message.bytes > process.delivered)
          return current.send({ type: "attach", id: message.id, from: process.delivered })
        processes.delete(message.id)
        Deferred.doneUnsafe(process.exited, Effect.succeed(message))
        Queue.endUnsafe(process.output)
    }
  }

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

      const deliver = (current: Link, signal: Signal) => {
        current.send({ type: "kill", id: processID, signal })
        return Deferred.await(current.lost)
      }
      // Until the process is gone, sends the signal on each connection as it becomes active, as a kill is safe to
      // repeat. Without `persist` only on the current one, giving up when there is none or it is lost.
      const terminate = (signal: Signal, persist: boolean) =>
        Effect.suspend(() =>
          Deferred.isDoneUnsafe(process.exited)
            ? Effect.void
            : Effect.raceFirst(
                Effect.ignore(Deferred.await(process.exited)),
                persist
                  ? Effect.forever(Effect.flatMap(online, (current) => deliver(current, signal)))
                  : link
                    ? deliver(link, signal)
                    : Effect.void,
              ),
        )
      const stop = (stopOptions: ChildProcess.KillOptions | undefined, persist: boolean) => {
        const signal = stopOptions?.killSignal ?? killSignal
        if (!Schema.is(Signal)(signal)) return Effect.fail(unsupported(`${signal} is`))
        if (stopOptions?.forceKillAfter === undefined) return terminate(signal, persist)
        return Effect.timeoutOrElse(terminate(signal, persist), {
          duration: stopOptions.forceKillAfter,
          orElse: () => terminate("SIGKILL", persist),
        })
      }
      // Stopped like a local process when the scope that spawned it closes, but never waiting for a machine that is
      // away. Added before the start is sent, so a start still unanswered is covered.
      yield* Effect.addFinalizer(() =>
        Effect.ignore(
          stop(
            { killSignal, forceKillAfter: options.forceKillAfter ?? CrossSpawnSpawner.RELEASE_FORCE_KILL_AFTER },
            false,
          ),
        ),
      )
      live.send({
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
        Effect.tapError((error) => Effect.sync(() => gone(processID, process, error))),
        Effect.mapError(platform("spawn")),
      )

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
        kill: (killOptions) => stop(killOptions, true),
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
      current.send({ type: "fs", req: callID, ...request })
      return Deferred.await(reply).pipe(
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
