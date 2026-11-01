import { isArrayNonEmpty } from "effect/Array"
import * as NodeSink from "@effect/platform-node/NodeSink"
import * as NodeStream from "@effect/platform-node/NodeStream"
import {
  Deferred,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Path,
  PlatformError,
  Predicate,
  Redacted,
  Sink,
  Stream,
} from "effect"
import type { Scope } from "effect"
import { ChildProcess } from "effect/process"
import {
  ChildProcessSpawner,
  ExitCode,
  make,
  makeHandle,
  ProcessId,
  type ChildProcessHandle,
} from "effect/process/ChildProcessSpawner"
// ast-grep-ignore: no-star-import
import * as NodeChildProcess from "node:child_process"
import { PassThrough } from "node:stream"
import launch from "cross-spawn"
import { makeGlobalNode } from "./effect/app-node.js"
import { filesystem, path } from "./effect/app-node-platform.js"
import { Teardown } from "./teardown.js"

/** Closing a child's scope escalates to SIGKILL after this, unless the command sets its own `forceKillAfter`. */
export const RELEASE_FORCE_KILL_AFTER = "3 seconds"

// Process groups of running children. Exiting without stopping them (a shutdown deadline, a second signal, a
// crash) would orphan them, so a synchronous exit hook kills whatever is left.
const groups = new Set<number>()
let hooked = false
const killGroups = () =>
  groups.forEach((pid) => {
    try {
      globalThis.process.kill(-pid, "SIGKILL")
    } catch {
      // Already gone.
    }
  })

const unwrap = (value: string | Redacted.Redacted<string>): string =>
  Redacted.isRedacted(value) ? Redacted.value(value) : value

// Node's own NUL check throws an error that includes the value, so NUL is rejected here to keep Redacted values
// out of errors.
const findNulCharacter = (command: ChildProcess.StandardCommand): string | undefined => {
  if (command.command.includes("\0")) return "The command contains a NUL character"
  const index = command.args.findIndex((arg) => unwrap(arg).includes("\0"))
  if (index !== -1) return `Argument ${index + 1} contains a NUL character`
  for (const [name, value] of Object.entries(command.options.env ?? {})) {
    if (value !== undefined && unwrap(value).includes("\0")) {
      return `The environment variable ${name} contains a NUL character`
    }
  }
  return undefined
}

// Buffered writes can fail after the sink has been interrupted and removed its error listener. Keep a fallback until
// close, without replacing the sink listener that propagates errors while it is active.
const handleInputErrors = (writable: NodeJS.WritableStream) => {
  const onError = () => {}
  writable.on("error", onError)
  writable.once("close", () => writable.off("error", onError))
}

const toError = (err: unknown): Error => (err instanceof globalThis.Error ? err : new globalThis.Error(String(err)))

const toTag = (err: NodeJS.ErrnoException): PlatformError.SystemErrorTag => {
  switch (err.code) {
    case "ENOENT":
      return "NotFound"
    case "EACCES":
      return "PermissionDenied"
    case "EEXIST":
      return "AlreadyExists"
    case "EISDIR":
      return "BadResource"
    case "ENOTDIR":
      return "BadResource"
    case "EBUSY":
      return "Busy"
    case "ELOOP":
      return "BadResource"
    default:
      return "Unknown"
  }
}

const flatten = (command: ChildProcess.Command) => {
  const commands: Array<ChildProcess.StandardCommand> = []
  const opts: Array<ChildProcess.PipeOptions> = []

  const walk = (cmd: ChildProcess.Command): void => {
    switch (cmd._tag) {
      case "StandardCommand":
        commands.push(cmd)
        return
      case "PipedCommand":
        walk(cmd.left)
        opts.push(cmd.options)
        walk(cmd.right)
        return
    }
  }

  walk(command)
  if (!isArrayNonEmpty(commands)) throw new Error("flatten produced empty commands array")
  return {
    commands,
    opts,
  }
}

const toPlatformError = (
  method: string,
  err: NodeJS.ErrnoException,
  command: ChildProcess.Command,
): PlatformError.PlatformError => {
  const cmd = flatten(command)
    .commands.map((x) => `${x.command} ${x.args.join(" ")}`)
    .join(" | ")
  return PlatformError.systemError({
    _tag: toTag(err),
    module: "ChildProcess",
    method,
    pathOrDescriptor: cmd,
    syscall: err.syscall,
    cause: err,
  })
}

export class KilledBySignal extends Error {
  readonly signal: NodeJS.Signals

  constructor(signal: NodeJS.Signals) {
    super(`Process interrupted due to receipt of signal: '${signal}'`)
    this.signal = signal
  }
}

type ExitSignal = Deferred.Deferred<readonly [code: number | null, signal: NodeJS.Signals | null]>
type Spawned = readonly [
  process: NodeChildProcess.ChildProcess,
  closed: ExitSignal,
  exited: ExitSignal,
  settle: () => void,
]

const makeCrossSpawnSpawner = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  const cwd = Effect.fnUntraced(function* (opts: ChildProcess.CommandOptions) {
    if (Predicate.isUndefined(opts.cwd)) return undefined
    yield* fs.access(opts.cwd)
    return path.resolve(opts.cwd)
  })

  const env = (opts: ChildProcess.CommandOptions) => {
    if (opts.env === undefined) return opts.extendEnv ? globalThis.process.env : undefined
    const result: Record<string, string | undefined> = opts.extendEnv ? { ...globalThis.process.env } : {}
    for (const [key, value] of Object.entries(opts.env)) {
      if (value === undefined) delete result[key]
      else result[key] = unwrap(value)
    }
    return result
  }

  const input = (x: ChildProcess.CommandInput | undefined): NodeChildProcess.IOType | undefined =>
    Stream.isStream(x) ? "pipe" : x

  const output = (x: ChildProcess.CommandOutput | undefined): NodeChildProcess.IOType | undefined =>
    Sink.isSink(x) ? "pipe" : x

  const stdin = (opts: ChildProcess.CommandOptions): ChildProcess.StdinConfig => {
    const cfg: ChildProcess.StdinConfig = { stream: "pipe", encoding: "utf-8", endOnDone: true }
    if (Predicate.isUndefined(opts.stdin)) return cfg
    if (typeof opts.stdin === "string") return { ...cfg, stream: opts.stdin }
    if (Stream.isStream(opts.stdin)) return { ...cfg, stream: opts.stdin }
    return {
      stream: opts.stdin.stream,
      encoding: opts.stdin.encoding ?? cfg.encoding,
      endOnDone: opts.stdin.endOnDone ?? cfg.endOnDone,
    }
  }

  const stdio = (opts: ChildProcess.CommandOptions, key: "stdout" | "stderr"): ChildProcess.StdoutConfig => {
    const cfg = opts[key]
    if (Predicate.isUndefined(cfg)) return { stream: "pipe" }
    if (typeof cfg === "string") return { stream: cfg }
    if (Sink.isSink(cfg)) return { stream: cfg }
    return { stream: cfg.stream }
  }

  const fds = (opts: ChildProcess.CommandOptions) => {
    if (Predicate.isUndefined(opts.additionalFds)) return []
    return Object.entries(opts.additionalFds)
      .flatMap(([name, config]) => {
        const fd = ChildProcess.parseFdName(name)
        return Predicate.isUndefined(fd) ? [] : [{ fd, config }]
      })
      .toSorted((a, b) => a.fd - b.fd)
  }

  const stdios = (
    sin: ChildProcess.StdinConfig,
    sout: ChildProcess.StdoutConfig,
    serr: ChildProcess.StderrConfig,
    extra: ReadonlyArray<{ fd: number; config: ChildProcess.AdditionalFdConfig }>,
  ): NodeChildProcess.StdioOptions => {
    const pipe = (x: NodeChildProcess.IOType | undefined) =>
      process.platform === "win32" && x === "pipe" ? "overlapped" : x
    const arr: Array<NodeChildProcess.IOType | undefined> = [
      pipe(input(sin.stream)),
      pipe(output(sout.stream)),
      pipe(output(serr.stream)),
    ]
    if (extra.length === 0) return arr as NodeChildProcess.StdioOptions
    const max = extra.reduce((acc, x) => Math.max(acc, x.fd), 2)
    for (let i = 3; i <= max; i++) arr[i] = "ignore"
    for (const x of extra) arr[x.fd] = pipe("pipe")
    return arr as NodeChildProcess.StdioOptions
  }

  const setupFds = Effect.fnUntraced(function* (
    command: ChildProcess.StandardCommand,
    proc: NodeChildProcess.ChildProcess,
    extra: ReadonlyArray<{ fd: number; config: ChildProcess.AdditionalFdConfig }>,
  ) {
    if (extra.length === 0) {
      return {
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      }
    }

    const ins = new Map<number, Sink.Sink<void, Uint8Array, never, PlatformError.PlatformError>>()
    const outs = new Map<number, Stream.Stream<Uint8Array, PlatformError.PlatformError>>()

    const setupInput = Effect.fnUntraced(function* (
      fd: number,
      node: NodeChildProcess.ChildProcess["stdio"][number],
      source: Stream.Stream<Uint8Array, PlatformError.PlatformError> | undefined,
    ) {
      let sink: Sink.Sink<void, Uint8Array, never, PlatformError.PlatformError> = Sink.drain
      if (node && "write" in node) {
        handleInputErrors(node)
        sink = NodeSink.fromWritable({
          evaluate: () => node,
          onError: (err) => toPlatformError(`fromWritable(fd${fd})`, toError(err), command),
          endOnDone: true,
        })
      }
      if (source) yield* Effect.forkScoped(Stream.run(source, sink))
      ins.set(fd, sink)
    })

    const setupOutput = (
      fd: number,
      node: NodeChildProcess.ChildProcess["stdio"][number],
      sink: Sink.Sink<Uint8Array, Uint8Array, never, PlatformError.PlatformError> | undefined,
    ) => {
      let stream: Stream.Stream<Uint8Array, PlatformError.PlatformError> = Stream.empty
      if (node && "read" in node) {
        const tap = new PassThrough()
        // Retain errors raised before anyone reads, e.g. a failed write on a duplex fd, so they neither go uncaught
        // nor leave later readers hanging.
        let error: unknown = undefined
        tap.on("error", (cause) => {
          error ??= cause
        })
        node.on("error", (err) => tap.destroy(toError(err)))
        node.pipe(tap)
        const onError = (err: unknown) => toPlatformError(`fromReadable(fd${fd})`, toError(err), command)
        stream = Stream.suspend(() =>
          error === undefined ? NodeStream.fromReadable({ evaluate: () => tap, onError }) : Stream.fail(onError(error)),
        )
      }
      if (sink) stream = Stream.transduce(stream, sink)
      outs.set(fd, stream)
    }

    for (const x of extra) {
      const node = proc.stdio[x.fd]
      switch (x.config.type) {
        case "input":
          yield* setupInput(x.fd, node, x.config.stream)
          break
        case "output":
          setupOutput(x.fd, node, x.config.sink)
          break
        case "duplex":
          // Keep writing possible after the child closes its write side.
          if (node && "allowHalfOpen" in node) node.allowHalfOpen = true
          setupOutput(x.fd, node, x.config.sink)
          yield* setupInput(x.fd, node, x.config.stream)
          break
      }
    }

    return {
      getInputFd: (fd: number) => ins.get(fd) ?? Sink.drain,
      getOutputFd: (fd: number) => outs.get(fd) ?? Stream.empty,
    }
  })

  const setupStdin = (
    command: ChildProcess.StandardCommand,
    proc: NodeChildProcess.ChildProcess,
    cfg: ChildProcess.StdinConfig,
  ) =>
    Effect.suspend(() => {
      let sink: Sink.Sink<void, unknown, never, PlatformError.PlatformError> = Sink.drain
      if (Predicate.isNotNull(proc.stdin)) {
        handleInputErrors(proc.stdin)
        sink = NodeSink.fromWritable({
          evaluate: () => proc.stdin!,
          onError: (err) => toPlatformError("fromWritable(stdin)", toError(err), command),
          endOnDone: cfg.endOnDone,
          encoding: cfg.encoding,
        })
      }
      if (Stream.isStream(cfg.stream)) return Effect.as(Effect.forkScoped(Stream.run(cfg.stream, sink)), sink)
      return Effect.succeed(sink)
    })

  const setupOutput = (
    command: ChildProcess.StandardCommand,
    proc: NodeChildProcess.ChildProcess,
    out: ChildProcess.StdoutConfig,
    err: ChildProcess.StderrConfig,
    stopOutput: Deferred.Deferred<void>,
  ) => {
    const capture = (readable: NodeChildProcess.ChildProcess["stdout"], name: string) => {
      if (!readable) return Stream.empty
      // Bun resumes stdio on exit; retain bytes before the lazy Effect reader attaches.
      const buffer = new PassThrough()
      readable.on("error", (cause) => buffer.destroy(toError(cause)))
      readable.pipe(buffer)
      return NodeStream.fromReadable({
        evaluate: () => buffer,
        onError: (cause) => toPlatformError(`fromReadable(${name})`, toError(cause), command),
      }).pipe(
        Stream.interruptWhen(Deferred.await(stopOutput)),
        Stream.ensuring(
          Effect.gen(function* () {
            // Only the capture deadline transfers the reader back to the process scope.
            if (yield* Deferred.isDone(stopOutput)) return
            readable.destroy()
          }),
        ),
      )
    }

    let stdout = capture(proc.stdout, "stdout")
    let stderr = capture(proc.stderr, "stderr")
    if (Sink.isSink(out.stream)) stdout = Stream.transduce(stdout, out.stream)
    if (Sink.isSink(err.stream)) stderr = Stream.transduce(stderr, err.stream)

    return { stdout, stderr, all: Stream.merge(stdout, stderr) }
  }

  const launchProcess = (command: ChildProcess.StandardCommand, opts: NodeChildProcess.SpawnOptions) =>
    Effect.callback<Spawned, PlatformError.PlatformError>((resume) => {
      const closed = Deferred.makeUnsafe<readonly [code: number | null, signal: NodeJS.Signals | null]>()
      const exited = Deferred.makeUnsafe<readonly [code: number | null, signal: NodeJS.Signals | null]>()
      const proc = launch(command.command, command.args.map(unwrap), opts)
      let settle = () => {}
      let end = false
      let exit: readonly [code: number | null, signal: NodeJS.Signals | null] | undefined
      proc.on("error", (err) => {
        // Node copies the arguments into `spawnargs`.
        if (command.args.some(Redacted.isRedacted)) {
          Object.assign(err, {
            spawnargs: [command.command, ...command.args.map((arg) => (Redacted.isRedacted(arg) ? "<redacted>" : arg))],
          })
        }
        resume(Effect.fail(toPlatformError("spawn", err, command)))
      })
      proc.on("exit", (...args) => {
        groups.delete(proc.pid!)
        exit = args
        Deferred.doneUnsafe(exited, Exit.succeed(args))
      })
      proc.on("close", (...args) => {
        if (end) return
        end = true
        settle()
        Deferred.doneUnsafe(exited, Exit.succeed(exit ?? args))
        Deferred.doneUnsafe(closed, Exit.succeed(exit ?? args))
      })
      proc.on("spawn", () => {
        if (opts.detached && globalThis.process.platform !== "win32") {
          if (!hooked) globalThis.process.once("exit", killGroups)
          hooked = true
          groups.add(proc.pid!)
        }
        settle = Teardown.track(
          `child ${proc.pid} running: ${[command.command, ...command.args].join(" ").slice(0, 200)}`,
        )
        resume(Effect.succeed([proc, closed, exited, () => settle()]))
      })
      return Effect.sync(() => {
        proc.kill("SIGTERM")
      })
    })

  const spawn = Effect.fnUntraced(function* (
    command: ChildProcess.StandardCommand,
    opts: NodeChildProcess.SpawnOptions,
  ) {
    yield* Effect.logInfo("spawning process", { command: command.command, args: command.args, cwd: opts.cwd })
    const [proc, closed, exited, settle] = yield* launchProcess(command, opts)
    const stopOutput = yield* Deferred.make<void>()
    // Register before process release so the deadline remains active during termination.
    yield* Effect.forkScoped(
      Effect.gen(function* () {
        yield* Deferred.await(exited)
        // Particularly on Windows, some shell calls will cause detached descendants. Inherited stdio can hang the call.
        // Almost every ecosystem has tried to fix this; there's no single "good" answer here.
        // Calls that trigger this are e.g. dotnet build with warmed MSBuild processes, agent-browser, etc.
        // One shared deadline covers stdout and stderr, then the output pump finishes its file.
        if ((yield* Effect.timeoutOption(Deferred.await(closed), "1 second"))._tag === "Some") return
        yield* Deferred.succeed(stopOutput, undefined)
        discard(proc.stdout)
        discard(proc.stderr)
      }),
    )
    return [proc, closed, exited, stopOutput, settle] as const
  })

  const discard = (readable: NodeChildProcess.ChildProcess["stdout"]) => {
    if (!readable || readable.destroyed) return
    readable.unpipe()
    // Discard descendant output without refilling a capture buffer that is no longer consumed.
    const drain = () => {
      while (readable.read() !== null) {}
    }
    readable.on("readable", drain)
    readable.once("error", () => {})
    readable.once("close", () => readable.off("readable", drain))
    drain()
  }

  const killGroup = (
    command: ChildProcess.StandardCommand,
    proc: NodeChildProcess.ChildProcess,
    signal: NodeJS.Signals,
  ) => {
    if (globalThis.process.platform === "win32") {
      return Effect.callback<void, PlatformError.PlatformError>((resume) => {
        NodeChildProcess.exec(`taskkill /pid ${proc.pid} /T /F`, { windowsHide: true }, (err) => {
          if (err) return resume(Effect.fail(toPlatformError("kill", toError(err), command)))
          resume(Effect.void)
        })
      })
    }

    return Effect.try({
      try: () => {
        globalThis.process.kill(-proc.pid!, signal)
      },
      catch: (err) => toPlatformError("kill", toError(err), command),
    })
  }

  const killOne = (
    command: ChildProcess.StandardCommand,
    proc: NodeChildProcess.ChildProcess,
    signal: NodeJS.Signals,
  ) =>
    Effect.suspend(() => {
      if (proc.kill(signal)) return Effect.void
      return Effect.fail(toPlatformError("kill", new Error("Failed to kill child process"), command))
    })

  const stop = (
    command: ChildProcess.StandardCommand,
    proc: NodeChildProcess.ChildProcess,
    closed: ExitSignal,
    stopOutput: Deferred.Deferred<void>,
    opts: ChildProcess.KillOptions | undefined,
  ) => {
    const terminate = (signal: NodeJS.Signals) =>
      Effect.catch(killGroup(command, proc, signal), () => killOne(command, proc, signal)).pipe(
        Effect.andThen(
          signal === "SIGKILL"
            ? Effect.raceFirst(Deferred.await(closed), Deferred.await(stopOutput))
            : Deferred.await(closed),
        ),
        Effect.asVoid,
      )
    const attempt = terminate(opts?.killSignal ?? "SIGTERM")
    if (opts?.forceKillAfter === undefined) return attempt
    return Effect.timeoutOrElse(attempt, {
      duration: opts.forceKillAfter,
      orElse: () => terminate("SIGKILL"),
    })
  }

  const source = (handle: ChildProcessHandle, from: ChildProcess.PipeFromOption | undefined) => {
    const opt = from ?? "stdout"
    switch (opt) {
      case "stdout":
        return handle.stdout
      case "stderr":
        return handle.stderr
      case "all":
        return handle.all
      default: {
        const fd = ChildProcess.parseFdName(opt)
        return Predicate.isNotUndefined(fd) ? handle.getOutputFd(fd) : handle.stdout
      }
    }
  }

  const spawnCommand: (
    command: ChildProcess.Command,
  ) => Effect.Effect<ChildProcessHandle, PlatformError.PlatformError, Scope.Scope> = Effect.fnUntraced(
    function* (command) {
      switch (command._tag) {
        case "StandardCommand": {
          const nul = findNulCharacter(command)
          if (nul !== undefined) {
            return yield* Effect.fail(
              PlatformError.badArgument({ module: "ChildProcess", method: "spawn", description: nul }),
            )
          }
          const sin = stdin(command.options)
          const sout = stdio(command.options, "stdout")
          const serr = stdio(command.options, "stderr")
          const extra = fds(command.options)
          const dir = yield* cwd(command.options)

          const [proc, closed, exited, stopOutput] = yield* Effect.acquireRelease(
            spawn(command, {
              cwd: dir,
              env: env(command.options),
              stdio: stdios(sin, sout, serr, extra),
              detached: command.options.detached ?? process.platform !== "win32",
              shell: command.options.shell,
              windowsHide: process.platform === "win32",
            }),
            Effect.fnUntraced(
              function* ([proc, closed, exited, stopOutput]) {
                const done = (yield* Deferred.isDone(closed)) || (yield* Deferred.isDone(stopOutput))
                if (done) {
                  const [code] = yield* Deferred.await(exited)
                  if (process.platform === "win32") return
                  if (code === 0 || Predicate.isNull(code)) return
                  if (command.options.forceKillAfter === undefined) {
                    return yield* Effect.ignore(killGroup(command, proc, command.options.killSignal ?? "SIGTERM"))
                  }
                }
                yield* Effect.ignore(
                  stop(command, proc, closed, stopOutput, {
                    killSignal: command.options.killSignal,
                    forceKillAfter: command.options.forceKillAfter ?? RELEASE_FORCE_KILL_AFTER,
                  }),
                )
              },
              (effect, [proc, , , stopOutput, settle]) =>
                effect.pipe(
                  Effect.ensuring(
                    Effect.gen(function* () {
                      // A detached descendant holding the pipes can keep "close" from ever firing.
                      settle()
                      yield* Deferred.succeed(stopOutput, undefined)
                      proc.stdout?.destroy()
                      proc.stderr?.destroy()
                    }),
                  ),
                ),
            ),
          )

          const completion = Effect.raceFirst(
            Deferred.await(closed),
            Deferred.await(stopOutput).pipe(Effect.andThen(Deferred.await(exited))),
          )
          const fd = yield* setupFds(command, proc, extra)
          const out = setupOutput(command, proc, sout, serr, stopOutput)
          let ref = true
          return makeHandle({
            pid: ProcessId(proc.pid!),
            stdin: yield* setupStdin(command, proc, sin),
            stdout: out.stdout,
            stderr: out.stderr,
            all: out.all,
            getInputFd: fd.getInputFd,
            getOutputFd: fd.getOutputFd,
            isRunning: Effect.gen(function* () {
              return !(yield* Deferred.isDone(closed)) && !(yield* Deferred.isDone(stopOutput))
            }),
            exitCode: Effect.flatMap(completion, ([code, signal]) => {
              if (Predicate.isNotNull(code)) return Effect.succeed(ExitCode(code))
              // Node reports a signal whenever the exit code is null.
              return Effect.fail(toPlatformError("exitCode", new KilledBySignal(signal!), command))
            }),
            kill: (opts?: ChildProcess.KillOptions) => stop(command, proc, closed, stopOutput, opts),
            unref: Effect.sync(() => {
              if (ref) {
                proc.unref()
                ref = false
              }
              return Effect.sync(() => {
                if (!ref) {
                  proc.ref()
                  ref = true
                }
              })
            }),
          })
        }
        case "PipedCommand": {
          const flat = flatten(command)
          const [head, ...tail] = flat.commands
          let handle = spawnCommand(head)
          for (let i = 0; i < tail.length; i++) {
            const next = tail[i]
            const opts = flat.opts[i] ?? {}
            const sin = stdin(next.options)
            const stream = Stream.unwrap(Effect.map(handle, (x) => source(x, opts.from)))
            const to = opts.to ?? "stdin"
            if (to === "stdin") {
              handle = spawnCommand(
                ChildProcess.make(next.command, next.args, {
                  ...next.options,
                  stdin: { ...sin, stream },
                }),
              )
              continue
            }
            const fd = ChildProcess.parseFdName(to)
            if (Predicate.isUndefined(fd)) {
              handle = spawnCommand(
                ChildProcess.make(next.command, next.args, {
                  ...next.options,
                  stdin: { ...sin, stream },
                }),
              )
              continue
            }
            const name = ChildProcess.fdName(fd) as `fd${number}`
            const existing = next.options.additionalFds?.[name]
            handle = spawnCommand(
              ChildProcess.make(next.command, next.args, {
                ...next.options,
                additionalFds: {
                  ...next.options.additionalFds,
                  [name]: existing?.type === "duplex" ? { ...existing, stream } : { type: "input", stream },
                },
              }),
            )
          }
          return yield* handle
        }
      }
    },
  )

  return make(spawnCommand)
})

const layer: Layer.Layer<ChildProcessSpawner, never, FileSystem.FileSystem | Path.Path> = Layer.effect(
  ChildProcessSpawner,
  makeCrossSpawnSpawner,
)

export const node = makeGlobalNode({ service: ChildProcessSpawner, layer, deps: [filesystem, path] })

export * as CrossSpawnSpawner from "./cross-spawn-spawner.js"
