import { dlopen, ptr, read, type Pointer } from "bun:ffi"
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs"
import path from "node:path"
import { Effect, Schema } from "effect"

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
    operation: Schema.String,
    code: Schema.String,
  }) {
    override get message() {
      return `Process lock ${this.operation} failed for ${this.file}: ${this.code}`
    }
  }

  export type LockError = HeldError | SystemError

  export const acquire = Effect.fn("ProcessLock.acquire")(function* (file: string) {
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
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          closeSync(fd)
        }),
      )
      return
    }
    closeSync(fd)
    yield* result.held
      ? new HeldError({ file })
      : new SystemError({ file, operation: "acquire", code: String(result.code) })
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
const LOCKFILE_FAIL_IMMEDIATELY = 1
const LOCKFILE_EXCLUSIVE_LOCK = 2
const ERROR_LOCK_VIOLATION = 33

function lock(fd: number): Result {
  if (process.platform === "darwin") return lockDarwin(fd)
  if (process.platform === "linux") return lockLinux(fd)
  if (process.platform === "win32") return lockWindows(fd)
  throw new Error(`Unsupported process lock platform: ${process.platform}`)
}

function lockDarwin(fd: number): Result {
  const library = dlopen("/usr/lib/libSystem.B.dylib", {
    flock: { args: ["i32", "i32"], returns: "i32" },
    __error: { args: [], returns: "ptr" },
  })
  const result = library.symbols.flock(fd, LOCK_EX | LOCK_NB)
  const code = result === 0 ? 0 : errorCode(library.symbols.__error())
  library.close()
  if (result === 0) return { acquired: true }
  if (code === DARWIN_EWOULDBLOCK) return { acquired: false, held: true }
  return { acquired: false, held: false, code }
}

function lockLinux(fd: number): Result {
  const musl = `/lib/libc.musl-${process.arch === "arm64" ? "aarch64" : "x86_64"}.so.1`
  const library = dlopen(existsSync(musl) ? musl : "libc.so.6", {
    flock: { args: ["i32", "i32"], returns: "i32" },
    __errno_location: { args: [], returns: "ptr" },
  })
  const result = library.symbols.flock(fd, LOCK_EX | LOCK_NB)
  const code = result === 0 ? 0 : errorCode(library.symbols.__errno_location())
  library.close()
  if (result === 0) return { acquired: true }
  if (code === LINUX_EWOULDBLOCK) return { acquired: false, held: true }
  return { acquired: false, held: false, code }
}

function lockWindows(fd: number): Result {
  const runtime = dlopen("ucrtbase.dll", {
    _get_osfhandle: { args: ["i32"], returns: "i64" },
  })
  const kernel = dlopen("kernel32.dll", {
    LockFileEx: { args: ["u64", "u32", "u32", "u32", "u32", "ptr"], returns: "i32" },
    GetLastError: { args: [], returns: "u32" },
  })
  const handle = runtime.symbols._get_osfhandle(fd)
  const result = kernel.symbols.LockFileEx(
    handle,
    LOCKFILE_FAIL_IMMEDIATELY | LOCKFILE_EXCLUSIVE_LOCK,
    0,
    1,
    0,
    ptr(new Uint8Array(32)),
  )
  const code = result === 0 ? kernel.symbols.GetLastError() : 0
  runtime.close()
  kernel.close()
  if (result !== 0) return { acquired: true }
  if (code === ERROR_LOCK_VIOLATION) return { acquired: false, held: true }
  return { acquired: false, held: false, code }
}

function errorCode(pointer: Pointer | null) {
  if (pointer === null) throw new Error("Failed to read process lock error code")
  return read.i32(pointer, 0)
}
