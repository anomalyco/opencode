import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { posix } from "node:path"
import { Cause, Deferred, Effect, PlatformError, Queue, Redacted, Schema, Sink, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { Environment } from "../environment/index.js"
import { Failed, NotFound, WrongKind, type DirEntry, type FileInfo } from "../environment/files.js"
import {
  ProcessID,
  Signal,
  type FileCall,
  type FromWorker,
  type Hello,
  type Instance,
  type PeerCall,
  type PeerLink,
  type ToWorker,
} from "./wire.js"

/** How long a start whose connection was lost waits for the worker to come back before it is reported unknown. */
const START_GRACE = "15 seconds"
/** The worker refuses a stdin write larger than 64 KiB. */
const MAX_STDIN_CHUNK_SIZE = 64 * 1024

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

/** The worker no longer has a process: it restarted, or it forgot the process. */
export class ProcessLost extends Schema.TaggedError<ProcessLost>()("Machine.ProcessLost", {
  machine: Environment.ID,
  restarted: Schema.Boolean,
}) {
  override get message() {
    return this.restarted
      ? `${this.machine}'s worker restarted, the process was lost`
      : `${this.machine}'s worker no longer has the process`
  }
}

/** A worker refused or could not finish a peer request. */
export class PeerFailed extends Schema.TaggedError<PeerFailed>()("Machine.PeerFailed", {
  machine: Environment.ID,
  reason: Schema.String,
}) {
  override get message() {
    return `${this.machine}: ${this.reason}`
  }
}

/** A peer request as the home asks for it, before it is given a `req`. */
export type PeerRequest<M = PeerCall> = M extends unknown ? Omit<M, "req"> : never

export const ConnectionInfo = Schema.Struct({
  kind: Schema.Literals(["websocket", "iroh"]),
  path: Schema.optionalKey(Schema.Literals(["direct", "relayed"])),
  /** Round-trip time in milliseconds. */
  rtt: Schema.optionalKey(Schema.Number),
})

/** One connection from the worker, as the endpoint that accepted it hands it over. */
export interface Connection {
  readonly describe?: () => typeof ConnectionInfo.Type
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
  /**
   * Ends the machine for good: loses its connection and fails every process still tracked with `error`, so nothing
   * waits on an instance that will not be used again.
   */
  readonly close: (error: Error) => void
  /** The hello of the connection being served, if there is one. */
  readonly hello: () => Hello | undefined
  readonly describe: () => typeof ConnectionInfo.Type | undefined
  /** Sends one peer request on the current connection and waits for its answer. */
  readonly peer: (request: PeerRequest) => Effect.Effect<void, PeerFailed | NotSent | Unknown>
  /** The peer links that are up, as the current connection's hello and messages since report them. */
  readonly links: () => ReadonlySet<PeerLink>
}

type Reply = Extract<FromWorker, { type: "fs" }>
type PeerReply = Extract<FromWorker, { type: "peer" }>

interface Link {
  readonly describe: Connection["describe"]
  readonly hello: Hello
  readonly send: Connection["send"]
  readonly lost: Deferred.Deferred<void>
  /** File calls sent on this connection and not yet answered. */
  readonly calls: Map<number, Deferred.Deferred<Reply, Unknown>>
  readonly inputs: Map<number, { id: ProcessID; reply: Deferred.Deferred<void, Error> }>
  /** Peer requests sent on this connection and not yet answered. */
  readonly peers: Map<number, Deferred.Deferred<PeerReply, Unknown>>
  readonly links: Set<PeerLink>
}

type OutputQueue = Queue.Queue<Uint8Array, PlatformError.PlatformError | Cause.Done>

interface Process {
  readonly started: Deferred.Deferred<number, Error>
  readonly output: {
    readonly stdout: OutputQueue
    readonly stderr: OutputQueue
    readonly all: OutputQueue
  }
  readonly exited: Deferred.Deferred<Extract<FromWorker, { type: "exit" }>, Error>
  /** Bytes of output passed on so far, which is where an attach resumes. */
  delivered: number
  selectedView?: "merged" | "separate"
}

/** A file call as the files ask for it, before it is given a `req`. */
type Call<M = FileCall> = M extends unknown ? Omit<M, "type" | "req"> : never

/** A machine reached through a worker that dials in: its environment, and where the worker's connections arrive. */
export const make = (id: Environment.ID): Interface => {
  // Each change to this state, with the messages it sends, is one synchronous step: nothing else runs and nothing is
  // interrupted half-way through one, so a command is never reported unsent after it was sent. Hence the plain
  // variables and the `Unsafe` calls.
  const processes = new Map<ProcessID, Process>()
  let link: Link | undefined
  let next = Deferred.makeUnsafe<Link>()
  /** The worker behind the newest connection. Every process in `processes` was started on it. */
  let instance: Instance | undefined
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
    current.inputs.forEach((input) => Deferred.doneUnsafe(input.reply, Effect.fail(new Unknown({ machine: id }))))
    current.inputs.clear()
    current.peers.forEach((reply) => Deferred.doneUnsafe(reply, Effect.fail(new Unknown({ machine: id }))))
    current.links.clear()
  }

  // The process will not be heard from again: whoever waits on it gets `error`.
  const gone = (processID: ProcessID, process: Process, error: Error) => {
    processes.delete(processID)
    Deferred.doneUnsafe(process.started, Effect.fail(error))
    Deferred.doneUnsafe(process.exited, Effect.fail(error))
    Object.values(process.output).forEach((queue) =>
      Queue.failCauseUnsafe(queue, Cause.fail(platform("output")(error))),
    )
  }

  // Ends the machine for good: once its instance is dropped, nothing else can settle what it still tracks.
  const close = (error: Error) => {
    if (link) lose(link)
    for (const [processID, process] of processes) gone(processID, process, error)
  }

  const connect = (connection: Connection) =>
    Effect.suspend(() => {
      if (link) lose(link)
      const current: Link = {
        describe: connection.describe,
        hello: connection.hello,
        send: connection.send,
        lost: Deferred.makeUnsafe(),
        calls: new Map(),
        inputs: new Map(),
        peers: new Map(),
        links: new Set(connection.hello.links),
      }
      const restarted = connection.hello.instance !== instance
      instance = connection.hello.instance
      const listed = new Map(connection.hello.processes.map((entry) => [entry.id, entry]))
      // Nothing here will ever read a process this home does not know, so it is stopped and forgotten. The worker
      // signals at once and the release drops it, so its exit is never reported. A release is safe to repeat.
      for (const entry of connection.hello.processes) {
        if (processes.has(entry.id)) continue
        if (entry.state === "running") current.send({ type: "kill", id: entry.id, signal: "SIGKILL" })
        current.send({ type: "release", id: entry.id })
      }
      for (const [processID, process] of processes) {
        const entry = listed.get(processID)
        if (entry && !restarted) {
          // Settles a start whose reply was lost with the last connection.
          Deferred.doneUnsafe(process.started, Effect.succeed(entry.pid))
          current.send({ type: "attach", id: processID, from: process.delivered })
          continue
        }
        // A start the same worker does not list never reached it, so a retry is safe. A new worker lost everything, and
        // the same one may have forgotten a process it ran.
        gone(
          processID,
          process,
          Deferred.isDoneUnsafe(process.started)
            ? new ProcessLost({ machine: id, restarted })
            : restarted
              ? new Unknown({ machine: id })
              : new NotSent({ machine: id }),
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
    if (link !== current) return
    if (message.type === "stdin") {
      const input = current.inputs.get(message.req)
      if (input?.id !== message.id) return
      current.inputs.delete(message.req)
      Deferred.doneUnsafe(input.reply, message.ok ? Effect.void : Effect.fail(new Error(message.message)))
      return
    }
    if (message.type === "fs") {
      const call = current.calls.get(message.req)
      if (call) Deferred.doneUnsafe(call, Effect.succeed(message))
      return
    }
    if (message.type === "peer") {
      const reply = current.peers.get(message.req)
      if (reply) Deferred.doneUnsafe(reply, Effect.succeed(message))
      return
    }
    if (message.type === "peer-closed") {
      current.links.delete(message.link)
      return
    }
    const process = processes.get(message.id)
    if (!process) return
    switch (message.type) {
      case "started":
        Deferred.doneUnsafe(process.started, Effect.succeed(message.pid))
        return
      case "failed":
        // A refused start never ran, and a refused attach means the worker no longer has the process. A refused kill
        // changes nothing: the exit still arrives through the attach, or the attach is refused too.
        if (message.request === "start") gone(message.id, process, new Error(message.message))
        if (message.request === "attach") gone(message.id, process, new ProcessLost({ machine: id, restarted: false }))
        return
      case "output": {
        // A chunk past what was delivered follows a lost one; the exit's byte count attaches again from the gap.
        if (message.offset > process.delivered) return
        const fresh = message.data.subarray(process.delivered - message.offset)
        process.delivered += fresh.length
        if (fresh.length > 0) {
          Queue.offerUnsafe(process.output[message.stream], fresh)
          Queue.offerUnsafe(process.output.all, fresh)
        }
        return
      }
      case "exit":
        if (message.bytes > process.delivered) {
          current.send({ type: "attach", id: message.id, from: process.delivered })
          return
        }
        processes.delete(message.id)
        current.send({ type: "release", id: message.id })
        Deferred.doneUnsafe(process.exited, Effect.succeed(message))
        Object.values(process.output).forEach(Queue.endUnsafe)
    }
  }

  const spawner = ChildProcessSpawner.make((command) =>
    Effect.gen(function* () {
      if (command._tag === "PipedCommand") return yield* unsupported("piped commands are")
      const options = command.options
      const killSignal = options.killSignal ?? "SIGTERM"
      const input =
        options.stdin === undefined || typeof options.stdin === "string" || Stream.isStream(options.stdin)
          ? { stream: options.stdin ?? "ignore", endOnDone: true }
          : options.stdin
      const piped = input.stream === "pipe" || Stream.isStream(input.stream)
      if (input.stream !== "ignore" && !piped) return yield* unsupported("stdin is")
      if (options.shell) return yield* unsupported("the shell option is")
      if (options.additionalFds) return yield* unsupported("extra file descriptors are")
      if (options.cwd === undefined) return yield* unsupported("a command without a working directory is")
      if (!Schema.is(Signal)(killSignal)) return yield* unsupported(`${killSignal} is`)

      const processID = ProcessID.make(crypto.randomUUID())
      const process: Process = {
        started: Deferred.makeUnsafe(),
        output: yield* Effect.all({
          stdout: Queue.unbounded<Uint8Array, PlatformError.PlatformError | Cause.Done>(),
          stderr: Queue.unbounded<Uint8Array, PlatformError.PlatformError | Cause.Done>(),
          all: Queue.unbounded<Uint8Array, PlatformError.PlatformError | Cause.Done>(),
        }),
        exited: Deferred.makeUnsafe(),
        delivered: 0,
      }

      // Until the process is gone, sends the signal on each connection as it becomes current, as a kill is safe to
      // repeat.
      const terminate = (signal: Signal) =>
        Effect.flatMap(Deferred.isDone(process.exited), (exited) =>
          exited
            ? Effect.void
            : Effect.raceFirst(
                Effect.ignore(Deferred.await(process.exited)),
                Effect.forever(
                  Effect.flatMap(online, (current) => {
                    current.send({ type: "kill", id: processID, signal })
                    return Deferred.await(current.lost)
                  }),
                ),
              ),
        )
      const stop = (stopOptions?: ChildProcess.KillOptions) => {
        const signal = stopOptions?.killSignal ?? killSignal
        if (!Schema.is(Signal)(signal)) return Effect.fail(unsupported(`${signal} is`))
        if (stopOptions?.forceKillAfter === undefined) return terminate(signal)
        return Effect.timeoutOrElse(terminate(signal), {
          duration: stopOptions.forceKillAfter,
          orElse: () => terminate("SIGKILL"),
        })
      }
      const start: ToWorker = {
        type: "start",
        stdin: piped,
        id: processID,
        argv: [command.command, ...command.args.map(reveal)],
        cwd: options.cwd,
        // The worker's own environment is the base: the server's never crosses, and an unset cannot be sent.
        env: Object.fromEntries(
          Object.entries(options.env ?? {}).flatMap(([key, value]) =>
            value === undefined ? [] : [[key, reveal(value)]],
          ),
        ),
      }
      // Registered and sent in one step, on the connection that is current in that step. Stopped like a local process
      // when the scope that spawned it closes, a start still unanswered included, but never waiting for a machine that
      // is away: a process still there is forgotten, and stopped when the machine's next hello lists it.
      const live = yield* Effect.acquireRelease(
        Effect.suspend(() => {
          if (!link) return Effect.fail(platform("spawn")(new NotSent({ machine: id })))
          processes.set(processID, process)
          link.send(start)
          return Effect.succeed(link)
        }),
        () =>
          stop({ forceKillAfter: options.forceKillAfter ?? CrossSpawnSpawner.RELEASE_FORCE_KILL_AFTER }).pipe(
            Effect.raceFirst(Effect.suspend(() => (link ? Deferred.await(link.lost) : Effect.void))),
            Effect.ignore,
            Effect.ensuring(Effect.sync(() => processes.delete(processID))),
          ),
      )
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

      const write = (data: Uint8Array | null) =>
        Effect.suspend(() => {
          if (!link) return Effect.fail(new NotSent({ machine: id }))
          if ([...link.inputs.values()].some((input) => input.id === processID))
            return Effect.fail(new Error("stdin write already pending"))
          const reply = Deferred.makeUnsafe<void, Error>()
          const request = ++req
          link.inputs.set(request, { id: processID, reply })
          link.send({ type: "stdin", id: processID, req: request, data })
          return Deferred.await(reply)
        }).pipe(
          Effect.mapError((cause) =>
            PlatformError.systemError({
              _tag: "Unknown",
              module: "Machine",
              method: "stdin",
              description:
                cause instanceof Unknown
                  ? `Lost connection to ${id}. The stdin operation's outcome is unknown.`
                  : cause.message,
              cause,
            }),
          ),
        )
      const stdin = piped
        ? Sink.forEach((data: Uint8Array) =>
            Effect.forEach(
              Array.from({ length: Math.ceil(data.length / MAX_STDIN_CHUNK_SIZE) }, (_, index) =>
                data.subarray(index * MAX_STDIN_CHUNK_SIZE, (index + 1) * MAX_STDIN_CHUNK_SIZE),
              ),
              write,
              { discard: true },
            ),
          ).pipe(Sink.mapEffect(() => (input.endOnDone === false ? Effect.void : write(null))))
        : Sink.fail(unsupported("stdin is"))
      // Stop only when delivery was lost: unsent or unacknowledged input cannot be replayed.
      if (Stream.isStream(input.stream))
        yield* Effect.forkScoped(
          Stream.run(input.stream, stdin).pipe(
            Effect.tapError((error) =>
              error.reason.cause instanceof NotSent || error.reason.cause instanceof Unknown ? stop() : Effect.void,
            ),
          ),
        )
      // As with local pipes, consume either all or stdout/stderr. Drop the unused view,
      // so a long-lived stdio server does not retain a second, unread copy forever.
      const output = (stream: keyof Process["output"]) =>
        Stream.suspend(() => {
          if (process.selectedView === undefined) {
            process.selectedView = stream === "all" ? "merged" : "separate"
            if (process.selectedView === "merged") {
              Queue.shutdownUnsafe(process.output.stdout)
              Queue.shutdownUnsafe(process.output.stderr)
            }
            if (process.selectedView === "separate") Queue.shutdownUnsafe(process.output.all)
          }
          if ((process.selectedView === "merged") !== (stream === "all"))
            return Stream.fail(
              PlatformError.badArgument({
                module: "Machine",
                method: "output",
                description: "read either all, or stdout and stderr, not both",
              }),
            )
          return Stream.fromQueue(process.output[stream])
        })
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(pid),
        exitCode: Deferred.await(process.exited).pipe(
          Effect.flatMap((exit) =>
            exit.code === null
              ? Effect.fail(new CrossSpawnSpawner.KilledBySignal(exit.signal as NodeJS.Signals))
              : Effect.succeed(ChildProcessSpawner.ExitCode(exit.code)),
          ),
          Effect.mapError(platform("exitCode")),
        ),
        isRunning: Effect.map(Deferred.isDone(process.exited), (done) => !done),
        kill: stop,
        stdin,
        stdout: output("stdout"),
        stderr: output("stderr"),
        all: output("all"),
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
      const reply = Deferred.makeUnsafe<Reply, Unknown>()
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

  const peer = (request: PeerRequest) =>
    Effect.suspend((): Effect.Effect<void, PeerFailed | NotSent | Unknown> => {
      const current = link
      if (!current) return Effect.fail(new NotSent({ machine: id }))
      const peerID = ++req
      const reply = Deferred.makeUnsafe<PeerReply, Unknown>()
      current.peers.set(peerID, reply)
      current.send({ ...request, req: peerID })
      return Deferred.await(reply).pipe(
        Effect.ensuring(Effect.sync(() => current.peers.delete(peerID))),
        Effect.flatMap((answer) => {
          if (!answer.ok) return Effect.fail(new PeerFailed({ machine: id, reason: answer.message }))
          if (link !== current) return Effect.void
          if (request.type === "peer-accept" || request.type === "peer-connect") current.links.add(request.link)
          if (request.type === "peer-close") current.links.delete(request.link)
          return Effect.void
        }),
      )
    })

  return {
    connect,
    close,
    peer,
    links: () => link?.links ?? new Set(),
    hello: () => link?.hello,
    describe: () => link?.describe?.(),
    environment: Environment.make(
      id,
      {
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
      // A worker is a POSIX machine with none of this server's shell paths, and its driver runs only argv, cwd and
      // env: `sh -c` is the contract every worker can meet.
      {
        path: posix,
        shell: "sh",
        home: Effect.suspend(() =>
          link ? Effect.succeed(link.hello.home) : Effect.fail(new NotSent({ machine: id })),
        ),
      },
    ),
  }
}

const reveal = (value: string | Redacted.Redacted<string>) =>
  Redacted.isRedacted(value) ? Redacted.value(value) : value

export * as MachineDriver from "./driver.js"
