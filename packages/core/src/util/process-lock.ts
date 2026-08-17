import { lockDarwin, lockLinux, type LockResult } from "#process-lock-ffi"
import { closeSync, mkdirSync, openSync } from "node:fs"
import { connect, createServer, type Server, type Socket } from "node:net"
import path from "node:path"
import { Effect, Schema } from "effect"
import { Hash } from "./hash"

export namespace ProcessLock {
  export class HeldError extends Schema.TaggedErrorClass<HeldError>()("ProcessLockHeldError", {
    file: Schema.String,
  }) {
    override get message() {
      return `Process lock is already held: ${this.file}`
    }
  }

  export class SystemError extends Schema.TaggedErrorClass<SystemError>()("ProcessLockSystemError", {
    file: Schema.String,
    operation: Schema.Literals(["open", "acquire"]),
    code: Schema.String,
  }) {
    override get message() {
      return `Process lock ${this.operation} failed for ${this.file}: ${this.code}`
    }
  }

  export type LockError = HeldError | SystemError

  const acquirePosix = Effect.fnUntraced(function* (file: string) {
    const fd = yield* Effect.try({
      try: () => {
        mkdirSync(path.dirname(file), { recursive: true })
        return openSync(file, "a+", 0o600)
      },
      catch: (cause) =>
        new SystemError({
          file,
          operation: "open",
          code: cause instanceof Error ? cause.message : String(cause),
        }),
    })
    const result = yield* Effect.try({
      try: () => lock(fd),
      catch: (cause) =>
        new SystemError({
          file,
          operation: "acquire",
          code: cause instanceof Error ? cause.message : String(cause),
        }),
    }).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          closeSync(fd)
        }),
      ),
    )
    if (result.acquired) {
      return fd
    }
    closeSync(fd)
    return yield* result.held
      ? new HeldError({ file })
      : new SystemError({ file, operation: "acquire", code: String(result.code) })
  })

  export const acquire = Effect.fn("ProcessLock.acquire")(function* (file: string) {
    if (process.platform === "win32") {
      yield* Effect.acquireRelease(acquireWindows(file), closeWindows)
      return
    }
    yield* Effect.acquireRelease(acquirePosix(file), (fd) =>
      Effect.sync(() => {
        closeSync(fd)
      }),
    )
  })
}

function lock(fd: number): LockResult {
  if (process.platform === "darwin") return lockDarwin(fd)
  if (process.platform === "linux") return lockLinux(fd)
  throw new Error(`Unsupported process lock platform: ${process.platform}`)
}

function acquireWindows(file: string) {
  return Effect.callback<Server, ProcessLock.LockError>((resume) => {
    const server = createServer()
    let probe: Socket | undefined
    const pipe = `\\\\.\\pipe\\opencode-process-lock-${Hash.sha256(path.resolve(file).toLowerCase())}`
    const onError = (cause: NodeJS.ErrnoException) => {
      server.off("listening", onListening)
      probe = connect(pipe)
      const onProbeError = () => {
        probe?.off("connect", onConnect)
        resume(
          Effect.fail(
            new ProcessLock.SystemError({
              file,
              operation: "acquire",
              code: cause.code ?? cause.message,
            }),
          ),
        )
      }
      const onConnect = () => {
        probe?.off("error", onProbeError)
        probe?.destroy()
        resume(Effect.fail(new ProcessLock.HeldError({ file })))
      }
      probe.once("connect", onConnect)
      probe.once("error", onProbeError)
    }
    const onListening = () => {
      server.off("error", onError)
      resume(Effect.succeed(server))
    }
    server.once("error", onError)
    server.once("listening", onListening)
    server.on("connection", (socket) => socket.destroy())
    server.listen(pipe)
    return Effect.sync(() => {
      probe?.destroy()
      server.close()
    })
  })
}

function closeWindows(server: Server) {
  return Effect.callback<void>((resume) => {
    if (!server.listening) return resume(Effect.void)
    server.close((error) => resume(error ? Effect.die(error) : Effect.void))
  })
}
