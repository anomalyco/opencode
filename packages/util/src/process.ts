import path from "node:path"
import { Context, Duration, Effect, Fiber, Layer, Schema, Stream } from "effect"
import type { PlatformError } from "effect/PlatformError"
import { ChildProcess } from "effect/process"
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import type { Worker } from "node:worker_threads"
import { CrossSpawnSpawner } from "./cross-spawn-spawner.js"
import { makeGlobalNode } from "./effect/app-node.js"
import { ProcessLauncher } from "./process-launcher.js"
import type { Run } from "./process-launcher-worker.js"

export class AppProcessError extends Schema.TaggedError<AppProcessError>()("AppProcessError", {
  command: Schema.String,
  exitCode: Schema.optional(Schema.Number),
  stderr: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message() {
    const detail =
      this.stderr?.trim() || (this.cause instanceof Error ? this.cause.message : this.cause && String(this.cause))
    const status = this.exitCode === undefined ? "" : ` (exit ${this.exitCode})`
    return `Command failed${status}: ${this.command}${detail ? `: ${detail}` : ""}`
  }
}

export interface RunOptions {
  readonly combineOutput?: boolean
  readonly maxOutputBytes?: number
  readonly maxErrorBytes?: number
  readonly signal?: AbortSignal
  readonly timeout?: Duration.Input
  readonly stdin?: string | Uint8Array | Stream.Stream<Uint8Array, PlatformError>
}

export interface RunStreamOptions {
  readonly signal?: AbortSignal
  readonly includeStderr?: boolean
  readonly okExitCodes?: ReadonlyArray<number>
  readonly maxErrorBytes?: number
}

export interface RunResult {
  readonly command: string
  readonly exitCode: number
  readonly output?: Buffer
  readonly stdout: Buffer
  readonly stderr: Buffer
  readonly outputTruncated?: boolean
  readonly stdoutTruncated: boolean
  readonly stderrTruncated: boolean
}

export type Interface = ChildProcessSpawner["Service"] & {
  readonly run: (command: ChildProcess.Command, options?: RunOptions) => Effect.Effect<RunResult, AppProcessError>
  readonly runStream: (
    command: ChildProcess.Command,
    options?: RunStreamOptions,
  ) => Stream.Stream<string, AppProcessError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/AppProcess") {}

export const requireSuccess = (result: RunResult): Effect.Effect<RunResult, AppProcessError> =>
  result.exitCode === 0
    ? Effect.succeed(result)
    : Effect.fail(
        new AppProcessError({
          command: result.command,
          exitCode: result.exitCode,
          stderr: result.stderr.toString("utf8"),
        }),
      )

export const requireExitIn =
  (codes: ReadonlyArray<number>) =>
  (result: RunResult): Effect.Effect<RunResult, AppProcessError> =>
    codes.includes(result.exitCode)
      ? Effect.succeed(result)
      : Effect.fail(
          new AppProcessError({
            command: result.command,
            exitCode: result.exitCode,
            stderr: result.stderr.toString("utf8"),
          }),
        )

const describeCommand = (command: ChildProcess.Command): string => {
  if (command._tag === "StandardCommand") {
    return command.args.length ? `${command.command} ${command.args.join(" ")}` : command.command
  }
  return `${describeCommand(command.left)} | ${describeCommand(command.right)}`
}

const wrapError = (description: string, cause: unknown): AppProcessError =>
  cause instanceof AppProcessError ? cause : new AppProcessError({ command: description, cause })

export const abortError = (signal: AbortSignal): Error => {
  const reason = signal.reason
  if (reason instanceof Error) return reason
  const err = new Error("Aborted")
  err.name = "AbortError"
  return err
}

export const waitForAbort = (signal: AbortSignal) =>
  Effect.callback<never, Error>((resume) => {
    if (signal.aborted) {
      resume(Effect.fail(abortError(signal)))
      return
    }
    const onabort = () => resume(Effect.fail(abortError(signal)))
    signal.addEventListener("abort", onabort, { once: true })
    return Effect.sync(() => signal.removeEventListener("abort", onabort))
  })

const normalizeStdin = (
  input: string | Uint8Array | Stream.Stream<Uint8Array, PlatformError>,
): Stream.Stream<Uint8Array, PlatformError> =>
  typeof input === "string"
    ? Stream.make(new TextEncoder().encode(input))
    : input instanceof Uint8Array
      ? Stream.make(input)
      : input

export const collectStream = (stream: Stream.Stream<Uint8Array, PlatformError>, maxOutputBytes: number | undefined) =>
  Stream.runFold(
    stream,
    () => ({ chunks: [] as Uint8Array[], bytes: 0, truncated: false }),
    (acc, chunk) => {
      if (maxOutputBytes === undefined) {
        acc.chunks.push(chunk)
        acc.bytes += chunk.length
        return acc
      }
      const remaining = maxOutputBytes - acc.bytes
      if (remaining > 0) acc.chunks.push(remaining >= chunk.length ? chunk : chunk.slice(0, remaining))
      acc.bytes += chunk.length
      acc.truncated = acc.truncated || acc.bytes > maxOutputBytes
      return acc
    },
  ).pipe(Effect.map((x) => ({ buffer: Buffer.concat(x.chunks), truncated: x.truncated })))

// Input the launcher thread can be handed up front: nothing, an open pipe nobody writes to, or bytes to write and
// close. A stream of input, or inherited stdin, needs the in-process spawner.
const offThreadStdin = (
  command: ChildProcess.StandardCommand,
  input: RunOptions["stdin"],
): Run["stdin"] | undefined => {
  if (typeof input === "string") return new TextEncoder().encode(input)
  // A view into a larger buffer would be cloned whole.
  if (input instanceof Uint8Array) return input.byteLength === input.buffer.byteLength ? input : input.slice()
  if (input !== undefined) return undefined
  const stdin = command.options.stdin
  if (stdin === undefined || stdin === "pipe") return "pipe"
  return stdin === "ignore" ? "ignore" : undefined
}

/**
 * The launcher thread's request for a run it can do: one command whose input is known up front and whose output is
 * collected. Anything else (streams, sinks, extra descriptors, inherited stdio) needs the in-process spawner, and so
 * does a NUL character, which the spawner rejects without echoing a redacted value. `killSignal` and
 * `forceKillAfter` do not apply: on Windows a child is stopped by ending its whole process tree at once, here as in
 * the spawner.
 */
const offThreadRequest = (
  command: ChildProcess.StandardCommand,
  options?: RunOptions,
): Omit<Run, "id" | "type"> | undefined => {
  if (process.platform !== "win32") return undefined
  const opts = command.options
  if (opts.additionalFds !== undefined) return undefined
  if (opts.stdout !== undefined && opts.stdout !== "pipe") return undefined
  if (opts.stderr !== undefined && opts.stderr !== "pipe") return undefined
  const stdin = offThreadStdin(command, options?.stdin)
  if (stdin === undefined) return undefined
  // A copy of this thread's environment: the launcher thread's own can be stale.
  const env = { ...(CrossSpawnSpawner.environment(opts) ?? process.env) }
  const args = command.args.map(CrossSpawnSpawner.unwrap)
  if ([command.command, ...args, ...Object.values(env)].some((value) => value?.includes("\0"))) return undefined
  return {
    file: command.command,
    args,
    cwd: opts.cwd === undefined ? undefined : path.resolve(opts.cwd),
    env,
    shell: opts.shell,
    detached: opts.detached,
    stdin,
    combineOutput: options?.combineOutput === true,
    maxOutputBytes: options?.maxOutputBytes,
    maxErrorBytes: options?.maxErrorBytes,
  }
}

const buffer = (data: Uint8Array) => Buffer.from(data.buffer, data.byteOffset, data.byteLength)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner

    const offThread = Effect.fnUntraced(function* (
      launcher: Worker,
      command: ChildProcess.StandardCommand,
      request: Omit<Run, "id" | "type">,
    ) {
      const description = describeCommand(command)
      yield* Effect.logDebug("spawning process", { command: request.file, args: command.args, cwd: request.cwd })
      const reply = yield* ProcessLauncher.run(launcher, request, description)
      if (reply.type === "failed") {
        return yield* new AppProcessError({
          command: description,
          cause: CrossSpawnSpawner.toPlatformError(
            reply.error.method,
            Object.assign(new Error(reply.error.message), { code: reply.error.code, syscall: reply.error.syscall }),
            command,
          ),
        })
      }
      if (reply.code === null) {
        return yield* new AppProcessError({
          command: description,
          cause: CrossSpawnSpawner.toPlatformError(
            "exitCode",
            new CrossSpawnSpawner.KilledBySignal(reply.signal ?? "SIGKILL"),
            command,
          ),
        })
      }
      if (request.combineOutput) {
        return {
          command: description,
          exitCode: reply.code,
          output: buffer(reply.stdout),
          stdout: Buffer.alloc(0),
          stderr: Buffer.alloc(0),
          outputTruncated: reply.stdoutTruncated,
          stdoutTruncated: false,
          stderrTruncated: false,
        } satisfies RunResult
      }
      return {
        command: description,
        exitCode: reply.code,
        stdout: buffer(reply.stdout),
        stderr: buffer(reply.stderr),
        stdoutTruncated: reply.stdoutTruncated,
        stderrTruncated: reply.stderrTruncated,
      } satisfies RunResult
    })

    const supervise = <E>(description: string, collect: Effect.Effect<RunResult, E>, options?: RunOptions) => {
      const timed = options?.timeout
        ? Effect.timeoutOrElse(collect, {
            duration: options.timeout,
            orElse: () => Effect.fail(new AppProcessError({ command: description, cause: new Error("Timed out") })),
          })
        : collect
      const aborted = options?.signal
        ? timed.pipe(
            Effect.raceFirst(
              waitForAbort(options.signal).pipe(Effect.mapError((cause) => wrapError(description, cause))),
            ),
          )
        : timed
      return aborted.pipe(Effect.mapError((cause) => wrapError(description, cause)))
    }

    const runCommand = (command: ChildProcess.Command, options?: RunOptions) => {
      const description = describeCommand(command)
      const collect = Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* spawner.spawn(command)
          if (options?.combineOutput) {
            const [output, exitCode] = yield* Effect.all(
              [collectStream(handle.all, options.maxOutputBytes), handle.exitCode],
              { concurrency: "unbounded" },
            )
            return {
              command: description,
              exitCode,
              output: output.buffer,
              stdout: Buffer.alloc(0),
              stderr: Buffer.alloc(0),
              outputTruncated: output.truncated,
              stdoutTruncated: false,
              stderrTruncated: false,
            } satisfies RunResult
          }
          const [stdout, stderr, exitCode] = yield* Effect.all(
            [
              collectStream(handle.stdout, options?.maxOutputBytes),
              collectStream(handle.stderr, options?.maxErrorBytes),
              handle.exitCode,
            ],
            { concurrency: "unbounded" },
          )
          return {
            command: description,
            exitCode,
            stdout: stdout.buffer,
            stderr: stderr.buffer,
            stdoutTruncated: stdout.truncated,
            stderrTruncated: stderr.truncated,
          } satisfies RunResult
        }),
      )
      return supervise(description, collect, options)
    }

    const run = Effect.fn("AppProcess.run")(function* (command: ChildProcess.Command, options?: RunOptions) {
      if (command._tag === "StandardCommand" && (yield* ProcessLauncher.Enabled)) {
        const request = offThreadRequest(command, options)
        const launcher = request ? yield* ProcessLauncher.thread : undefined
        if (request && launcher) {
          return yield* supervise(describeCommand(command), offThread(launcher, command, request), options)
        }
      }
      if (options?.stdin === undefined) return yield* runCommand(command, options)
      if (command._tag !== "StandardCommand") {
        return yield* new AppProcessError({
          command: describeCommand(command),
          cause: new Error("stdin option only supports StandardCommand; received PipedCommand"),
        })
      }
      const next = ChildProcess.make(command.command, command.args, {
        ...command.options,
        stdin: normalizeStdin(options.stdin),
      })
      return yield* runCommand(next, options)
    })

    const runStream = (
      command: ChildProcess.Command,
      options?: RunStreamOptions,
    ): Stream.Stream<string, AppProcessError> => {
      const description = describeCommand(command)
      const okExitCodes = options?.okExitCodes
      const built: Stream.Stream<string, AppProcessError | PlatformError> = Stream.unwrap(
        Effect.gen(function* () {
          const handle = yield* spawner.spawn(command)
          const streams =
            options?.includeStderr === true
              ? yield* handle.stderr.pipe(
                  Stream.broadcastN({ n: 2, capacity: 16 }),
                  Effect.map((copies) => ({
                    source: Stream.merge(handle.stdout, copies[0]),
                    diagnostics: copies[1],
                  })),
                )
              : { source: handle.stdout, diagnostics: handle.stderr }
          const stderrFiber = yield* Effect.forkScoped(
            collectStream(streams.diagnostics, options?.maxErrorBytes).pipe(
              Effect.map((x) => x.buffer.toString("utf8")),
            ),
          )
          const lines = streams.source.pipe(
            Stream.decodeText,
            Stream.splitLines,
            Stream.filter((line) => line.length > 0),
          )
          const tail = Stream.unwrap(
            Effect.gen(function* () {
              const code = yield* handle.exitCode
              if (okExitCodes && okExitCodes.length > 0 && !okExitCodes.includes(code)) {
                const stderr = yield* Fiber.join(stderrFiber)
                return Stream.fail(new AppProcessError({ command: description, exitCode: code, stderr }))
              }
              return Stream.empty
            }),
          )
          return Stream.concat(lines, tail) as Stream.Stream<string, AppProcessError | PlatformError>
        }),
      )
      const mapped = built.pipe(Stream.mapError((cause) => wrapError(description, cause)))
      if (!options?.signal) return mapped
      const signal = options.signal
      return mapped.pipe(
        Stream.interruptWhen(waitForAbort(signal).pipe(Effect.mapError((cause) => wrapError(description, cause)))),
      )
    }

    return Service.of({ ...spawner, run, runStream })
  }),
)

export const node = makeGlobalNode({ service: Service, layer: layer, deps: [CrossSpawnSpawner.node] })

export * as AppProcess from "./process.js"
