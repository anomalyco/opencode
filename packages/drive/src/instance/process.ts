import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FileSystem from "effect/FileSystem"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import type * as Scope from "effect/Scope"
import * as Scope_ from "effect/Scope"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"

export class ProcessError extends Schema.TaggedErrorClass<ProcessError>()(
  "ProcessError",
  {
    operation: Schema.String,
    command: Schema.Array(Schema.String),
    message: Schema.String,
  },
) {}

export interface SpawnOptions {
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string>>
  readonly extendEnv?: boolean
  readonly stdin?: "inherit" | "ignore"
  readonly stdout?: "inherit" | "ignore" | { readonly path: string }
  readonly stderr?: "inherit" | "ignore" | { readonly path: string }
  readonly detached?: boolean
}

export interface Running {
  readonly pid: number
  readonly exitCode: Effect.Effect<number, ProcessError>
  readonly isRunning: Effect.Effect<boolean, ProcessError>
  readonly terminate: Effect.Effect<void, ProcessError>
  readonly detach: Effect.Effect<void, ProcessError>
}

export interface Output {
  readonly status: number
  readonly stdout: string
  readonly stderr: string
}

type RunOutputMode = "capture" | "inherit" | "ignore"

export interface RunOptions extends Omit<
  SpawnOptions,
  "stdout" | "stderr" | "detached"
> {
  readonly stdout?: RunOutputMode
  readonly stderr?: RunOutputMode
  readonly stdoutLimit?: number
  readonly stderrLimit?: number
}

export const spawn = Effect.fn("Process.spawn")(function* (
  command: ReadonlyArray<string>,
  options: SpawnOptions = {},
) {
  const executable = command[0]
  if (executable === undefined)
    return yield* Effect.fail(processError("spawn", command, "cannot spawn an empty command"))

  const parentScope = yield* Scope_.Scope
  const processScope = yield* Scope_.fork(parentScope)
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const fileSystem = yield* FileSystem.FileSystem
  const handle = yield* spawner.spawn(
    ChildProcess.make(executable, command.slice(1), {
      cwd: options.cwd,
      env: options.env,
      extendEnv: options.extendEnv ?? false,
      stdin: options.stdin ?? "ignore",
      stdout: outputMode(options.stdout),
      stderr: outputMode(options.stderr),
      detached: options.detached,
      killSignal: "SIGKILL",
    }),
  ).pipe(
    Scope_.provide(processScope),
    Effect.mapError((cause) => processError("spawn", command, cause)),
    Effect.onError(() => Scope_.close(processScope, Exit.void)),
  )

  const drains: Array<Fiber.Fiber<void, ProcessError>> = []
  if (typeof options.stdout === "object")
    drains.push(
      yield* Stream.run(handle.stdout, fileSystem.sink(options.stdout.path)).pipe(
        Effect.mapError((cause) => processError("stdout", command, cause)),
        Effect.forkIn(processScope),
      ),
    )
  if (typeof options.stderr === "object")
    drains.push(
      yield* Stream.run(handle.stderr, fileSystem.sink(options.stderr.path)).pipe(
        Effect.mapError((cause) => processError("stderr", command, cause)),
        Effect.forkIn(processScope),
      ),
    )

  const exitCode = handle.exitCode.pipe(
    Effect.map(Number),
    Effect.catch(() => Effect.succeed(1)),
    Effect.tap(() =>
      Effect.forEach(drains, Fiber.join, {
        concurrency: "unbounded",
        discard: true,
      }),
    ),
  )
  const detached = yield* Ref.make(false)

  const terminate = Effect.uninterruptible(
    Effect.gen(function* () {
      const running = yield* handle.isRunning.pipe(
        Effect.mapError((cause) => processError("status", command, cause)),
      )
      if (!running) {
        yield* Scope_.close(processScope, Exit.void)
        return undefined
      }
      const graceful = yield* handle.kill({ killSignal: "SIGTERM" }).pipe(
        Effect.timeoutOption(1_000),
        Effect.mapError((cause) => processError("terminate", command, cause)),
      )
      if (Option.isNone(graceful))
        yield* handle.kill({ killSignal: "SIGKILL" }).pipe(
          Effect.mapError((cause) => processError("kill", command, cause)),
        )
      yield* exitCode
      yield* Scope_.close(processScope, Exit.void)
      return undefined
    }),
  )
  yield* Effect.addFinalizer(() =>
    Ref.get(detached).pipe(
      Effect.flatMap((isDetached) =>
        isDetached ? Effect.void : terminate.pipe(Effect.ignore),
      ),
    ),
  )
  yield* Effect.exit(exitCode).pipe(
    Effect.andThen(Scope_.close(processScope, Exit.void)),
    Effect.forkIn(parentScope),
  )

  const detach = handle.unref.pipe(
    Effect.asVoid,
    Effect.mapError((cause) => processError("detach", command, cause)),
    Effect.andThen(Ref.set(detached, true)),
    Effect.andThen(Scope_.close(processScope, Exit.void)),
  )

  return {
    pid: Number(handle.pid),
    exitCode,
    isRunning: handle.isRunning.pipe(
      Effect.mapError((cause) => processError("status", command, cause)),
    ),
    terminate,
    detach,
  } satisfies Running
})

export const run = Effect.fn("Process.run")(function* (
  command: ReadonlyArray<string>,
  options: RunOptions = {},
) {
  const executable = command[0]
  if (executable === undefined)
    return yield* Effect.fail(processError("run", command, "cannot run an empty command"))
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(
        ChildProcess.make(executable, command.slice(1), {
          cwd: options.cwd,
          env: options.env,
          extendEnv: options.extendEnv ?? false,
          stdin: options.stdin ?? "ignore",
          stdout: captureMode(options.stdout),
          stderr: captureMode(options.stderr),
          killSignal: "SIGKILL",
        }),
      ).pipe(Effect.mapError((cause) => processError("spawn", command, cause)))
      const stdout = yield* collectOutput(
        handle.stdout,
        options.stdout,
        options.stdoutLimit,
      ).pipe(
        Effect.mapError((cause) => processError("stdout", command, cause)),
        Effect.forkChild,
      )
      const stderr = yield* collectOutput(
        handle.stderr,
        options.stderr,
        options.stderrLimit,
      ).pipe(
        Effect.mapError((cause) => processError("stderr", command, cause)),
        Effect.forkChild,
      )
      const status = yield* handle.exitCode.pipe(
        Effect.map(Number),
        Effect.mapError((cause) => processError("wait", command, cause)),
      )
      return {
        status,
        stdout: yield* Fiber.join(stdout),
        stderr: yield* Fiber.join(stderr),
      } satisfies Output
    }),
  )
})

function outputMode(output: SpawnOptions["stdout"] | SpawnOptions["stderr"]) {
  return typeof output === "object" ? "pipe" : output ?? "ignore"
}

function captureMode(output: RunOutputMode | undefined) {
  return output === undefined || output === "capture" ? "pipe" : output
}

function collectOutput(
  stream: Stream.Stream<Uint8Array, unknown>,
  mode: RunOutputMode | undefined,
  limit: number | undefined,
) {
  if (mode === "inherit" || mode === "ignore") return Effect.succeed("")
  if (limit === undefined)
    return stream.pipe(
      Stream.decodeText(),
      Stream.mkString,
    )
  return Effect.gen(function* () {
    let output = ""
    yield* stream.pipe(
      Stream.decodeText(),
      Stream.runForEach((chunk) =>
        Effect.sync(() => {
          output = `${output}${chunk}`.slice(-limit)
        }),
      ),
    )
    return output
  })
}

function processError(
  operation: string,
  command: ReadonlyArray<string>,
  cause: unknown,
) {
  return new ProcessError({
    operation,
    command: [...command],
    message: cause instanceof Error ? cause.message : String(cause),
  })
}

export type Requirements =
  | Scope.Scope
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem

export * as Process from "./process.js"
