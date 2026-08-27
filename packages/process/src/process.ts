export * as ForegroundProcess from "@opencode-ai/process"

import { Cause, Deferred, Effect, Exit, Schema, Stream } from "effect"
import { execFile } from "node:child_process"
import type { Command, NativeProcess } from "./binding.ts"
export type { Command } from "./binding.ts"

export class ProcessError extends Schema.TaggedError<ProcessError>()("ProcessError", {
  operation: Schema.Literals(["start", "read", "terminate", "close", "exit"]),
  cause: Schema.Defect(),
}) {
  override get message() {
    return `Process ${this.operation} failed: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}`
  }
}

/** Scoped, headless Windows execution. Each output stream has one consumer. */
export const start = Effect.fn("ForegroundProcess.start")(function* (command: Command) {
  const binding = yield* Effect.tryPromise({
    try: () => import("#capture-binding"),
    catch: (cause) => new ProcessError({ operation: "start", cause }),
  })
  const exitCode = yield* Deferred.make<number, ProcessError>()
  let exited = false

  const terminate = Effect.fn("ForegroundProcess.terminate")(function* (child: NativeProcess) {
    if (exited) return
    yield* Effect.callback<void, ProcessError>((resume) => {
      execFile("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, (cause) => {
        resume(cause ? Effect.fail(new ProcessError({ operation: "terminate", cause })) : Effect.void)
      })
    }).pipe(
      // Parent termination is emergency cleanup, not proof of successful tree termination.
      Effect.onError(() => Effect.try({ try: () => child.terminate(), catch: (cause) => cause }).pipe(Effect.ignore)),
    )
    yield* Deferred.await(exitCode)
  }, Effect.uninterruptible)

  const child = yield* Effect.acquireRelease(
    Effect.try({
      try: () => {
        const child = binding.start(command)
        // Install observation inside acquisition: even an already-closed Scope can safely release it.
        child.exited.then(
          (code) => {
            exited = true
            Deferred.doneUnsafe(exitCode, Exit.succeed(code))
          },
          (cause) => Deferred.doneUnsafe(exitCode, Exit.fail(new ProcessError({ operation: "exit", cause }))),
        )
        return child
      },
      catch: (cause) => new ProcessError({ operation: "start", cause }),
    }),
    (child) =>
      terminate(child).pipe(
        Effect.ensuring(
          Effect.try({
            try: () => child.close(),
            catch: (cause) => new ProcessError({ operation: "close", cause }),
          }).pipe(Effect.orDie),
        ),
        Effect.orDie,
      ),
  )

  const stdout = readOutput(() => child.readStdout())
  const stderr = readOutput(() => child.readStderr())
  let outputStarted = false

  return {
    pid: child.pid,
    exitCode: Deferred.await(exitCode),
    stdout,
    stderr,
    output: Stream.unwrap(
      Effect.suspend(() => {
        if (outputStarted)
          return Effect.fail(
            new ProcessError({ operation: "read", cause: new Error("Combined output supports one subscription") }),
          )
        outputStarted = true
        return Effect.succeed(Stream.merge(stdout, stderr))
      }),
    ),
    terminate: () => terminate(child),
  }
})

/** Collect both byte streams and join process exit before releasing the capture. */
export const run = Effect.fn("ForegroundProcess.run")(function* (command: Command) {
  const child = yield* start(command)
  const [exitCode, stdout, stderr] = yield* Effect.all(
    [child.exitCode, Stream.runCollect(child.stdout), Stream.runCollect(child.stderr)],
    { concurrency: "unbounded" },
  )
  return { exitCode, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }
}, Effect.scoped)

function readOutput(next: () => Promise<Uint8Array | null>) {
  // Interruption stops the subscriber, not the native read. A later subscriber owns its result.
  let pending: Promise<Uint8Array | null> | undefined
  return Stream.fromEffectRepeat(
    Effect.gen(function* () {
      const bytes = yield* Effect.tryPromise({
        try: () => (pending ??= next()),
        catch: (cause) => new ProcessError({ operation: "read", cause }),
      })
      pending = undefined
      if (bytes === null) return yield* Cause.done()
      return bytes
    }),
  )
}
