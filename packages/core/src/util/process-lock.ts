import { dlopen, read, type Pointer } from "bun:ffi"
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs"
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

type Result =
  | { readonly acquired: true }
  | { readonly acquired: false; readonly held: true }
  | { readonly acquired: false; readonly held: false; readonly code: number }

const LOCK_EX = 2
const LOCK_NB = 4
const DARWIN_EWOULDBLOCK = 35
const LINUX_EWOULDBLOCK = 11

function lock(fd: number): Result {
  if (process.platform === "darwin") return lockDarwin(fd)
  if (process.platform === "linux") return lockLinux(fd)
  throw new Error(`Unsupported process lock platform: ${process.platform}`)
}

function lockDarwin(fd: number): Result {
  const library = dlopen("/usr/lib/libSystem.B.dylib", {
    flock: { args: ["i32", "i32"], returns: "i32" },
    __error: { args: [], returns: "ptr" },
  })
  try {
    const result = library.symbols.flock(fd, LOCK_EX | LOCK_NB)
    const code = result === 0 ? 0 : errorCode(library.symbols.__error())
    if (result === 0) return { acquired: true }
    if (code === DARWIN_EWOULDBLOCK) return { acquired: false, held: true }
    return { acquired: false, held: false, code }
  } finally {
    library.close()
  }
}

function lockLinux(fd: number): Result {
  const musl = `/lib/libc.musl-${process.arch === "arm64" ? "aarch64" : "x86_64"}.so.1`
  const library = dlopen(existsSync(musl) ? musl : "libc.so.6", {
    flock: { args: ["i32", "i32"], returns: "i32" },
    __errno_location: { args: [], returns: "ptr" },
  })
  try {
    const result = library.symbols.flock(fd, LOCK_EX | LOCK_NB)
    const code = result === 0 ? 0 : errorCode(library.symbols.__errno_location())
    if (result === 0) return { acquired: true }
    if (code === LINUX_EWOULDBLOCK) return { acquired: false, held: true }
    return { acquired: false, held: false, code }
  } finally {
    library.close()
  }
}

function errorCode(pointer: Pointer | null) {
  if (pointer === null) throw new Error("Failed to read process lock error code")
  return read.i32(pointer, 0)
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
