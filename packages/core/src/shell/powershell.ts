export * as PowerShellPool from "./powershell.js"

import { Cause, Deferred, Duration, Effect, Exit, Option, Queue, Schema, Scope, Sink, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import script from "./powershell-worker.ps1" with { type: "text" }
import type { Environment } from "../environment/index.js"

const IDLE_TIMEOUT = 30_000
const IDLE_LIMIT = 5

const Frame = Schema.Union([
  Schema.Struct({ type: Schema.Literal("output"), data: Schema.String }),
  Schema.Struct({ type: Schema.Literal("exit"), code: Schema.Number }),
])
const decodeFrame = Schema.decodeUnknownOption(Schema.fromJsonString(Frame))

type Invocation = {
  command: string
  cwd: string
  shell: string
  env: Record<string, string | undefined>
}

type Request = {
  output: Queue.Queue<Uint8Array, Cause.Done>
  exit: Deferred.Deferred<ChildProcessSpawner.ExitCode>
  completed: boolean
}

type Worker = {
  shell: string
  scope: Scope.Closeable
  handle: ChildProcessSpawner.ChildProcessHandle
  input: Queue.Queue<string, Cause.Done>
  active?: Request
  buffer: string
  timer?: ReturnType<typeof setTimeout>
}

export const make = Effect.fn("PowerShellPool.make")(function* (spawner: Environment.Interface["spawner"]) {
  const lifetime = yield* Effect.scope
  const context = yield* Effect.context()
  const runFork = Effect.runForkWith(context)
  const workers = new Set<Worker>()

  const close = (worker: Worker, code = 1) =>
    Effect.gen(function* () {
      if (!workers.delete(worker)) return
      if (worker.timer) clearTimeout(worker.timer)
      Queue.endUnsafe(worker.input)
      if (worker.active && !worker.active.completed) {
        worker.active.completed = true
        Queue.endUnsafe(worker.active.output)
        yield* Deferred.succeed(worker.active.exit, ChildProcessSpawner.ExitCode(code))
      }
      worker.active = undefined
      yield* Scope.close(worker.scope, Exit.void)
    })

  const complete = (worker: Worker, code: number) =>
    Effect.gen(function* () {
      const request = worker.active
      if (!request || request.completed) return
      request.completed = true
      worker.active = undefined
      Queue.endUnsafe(request.output)
      yield* Deferred.succeed(request.exit, ChildProcessSpawner.ExitCode(code))

      const idle = Array.from(workers).filter((candidate) => !candidate.active)
      if (idle.length <= IDLE_LIMIT) return
      worker.timer = setTimeout(() => runFork(close(worker)), IDLE_TIMEOUT)
      worker.timer.unref?.()
    })

  const start = Effect.fn("PowerShellPool.start")(function* (invocation: Invocation, request: Request) {
    const scope = yield* Scope.fork(lifetime)
    const input = yield* Queue.unbounded<string, Cause.Done>()
    const encoded = Buffer.from(script, "utf16le").toString("base64")
    const handle = yield* spawner
      .spawn(
        ChildProcess.make(invocation.shell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
          cwd: invocation.cwd,
          env: invocation.env,
          stdin: { stream: Stream.encodeText(Stream.fromQueue(input)), endOnDone: true },
          stdout: "pipe",
          stderr: "pipe",
          forceKillAfter: Duration.seconds(3),
        }),
      )
      .pipe(Scope.provide(scope))

    const worker: Worker = { shell: invocation.shell, scope, handle, input, active: request, buffer: "" }
    workers.add(worker)

    yield* Stream.runForEach(handle.stdout, (chunk) =>
      Effect.gen(function* () {
        worker.buffer += Buffer.from(chunk).toString("utf8")
        while (true) {
          const marker = worker.buffer.indexOf("\u001e")
          if (marker === -1) {
            if (worker.active && worker.buffer) Queue.offerUnsafe(worker.active.output, Buffer.from(worker.buffer))
            worker.buffer = ""
            return
          }
          if (marker > 0) {
            if (worker.active) Queue.offerUnsafe(worker.active.output, Buffer.from(worker.buffer.slice(0, marker)))
            worker.buffer = worker.buffer.slice(marker)
          }
          const index = worker.buffer.indexOf("\n")
          if (index === -1) return
          const line = worker.buffer.slice(1, index).replace(/\r$/, "")
          worker.buffer = worker.buffer.slice(index + 1)
          const decoded = decodeFrame(line)
          if (Option.isNone(decoded)) {
            if (worker.active) Queue.offerUnsafe(worker.active.output, Buffer.from(`\u001e${line}\n`))
            continue
          }
          if (decoded.value.type === "output") {
            if (worker.active) Queue.offerUnsafe(worker.active.output, Buffer.from(decoded.value.data, "base64"))
            continue
          }
          yield* complete(worker, decoded.value.code)
        }
      }),
    ).pipe(
      Effect.catch(() => close(worker)),
      Effect.forkIn(scope, { startImmediately: true }),
    )

    yield* Stream.runForEach(handle.stderr, (chunk) =>
      Effect.sync(() => {
        if (worker.active) Queue.offerUnsafe(worker.active.output, chunk)
      }),
    ).pipe(
      Effect.catch(() => Effect.void),
      Effect.forkIn(scope, { startImmediately: true }),
    )

    yield* handle.exitCode.pipe(
      Effect.flatMap((code) => close(worker, code)),
      Effect.catch(() => close(worker)),
      Effect.forkIn(scope, { startImmediately: true }),
    )

    return worker
  })

  const spawn = Effect.fn("PowerShellPool.spawn")(function* (invocation: Invocation) {
    const output = yield* Queue.unbounded<Uint8Array, Cause.Done>()
    const request: Request = {
      output,
      exit: Deferred.makeUnsafe<ChildProcessSpawner.ExitCode>(),
      completed: false,
    }
    const existing = Array.from(workers).find((candidate) => candidate.shell === invocation.shell && !candidate.active)
    if (existing) existing.active = request
    const worker = existing ?? (yield* start(invocation, request))
    if (worker.timer) {
      clearTimeout(worker.timer)
      worker.timer = undefined
    }

    yield* Effect.addFinalizer(() => (request.completed ? Effect.void : close(worker)))
    const payload = Buffer.from(
      JSON.stringify({ command: invocation.command, cwd: invocation.cwd, env: invocation.env }),
      "utf8",
    ).toString("base64")
    yield* Queue.offer(worker.input, `${payload}\n`)

    const stream = Stream.fromQueue(output)
    return ChildProcessSpawner.makeHandle({
      pid: worker.handle.pid,
      exitCode: Deferred.await(request.exit),
      isRunning: Effect.sync(() => !request.completed),
      kill: () => close(worker),
      stdin: Sink.drain,
      stdout: stream,
      stderr: Stream.empty,
      all: stream,
      getInputFd: () => Sink.drain,
      getOutputFd: () => Stream.empty,
      unref: Effect.succeed(Effect.void),
    })
  })

  return { spawn }
})
