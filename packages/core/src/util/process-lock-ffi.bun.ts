import { dlopen, read, type Pointer } from "bun:ffi"
import { existsSync } from "node:fs"

export type LockResult =
  | { readonly acquired: true }
  | { readonly acquired: false; readonly held: true }
  | { readonly acquired: false; readonly held: false; readonly code: number }

const LOCK_EX = 2
const LOCK_NB = 4
const DARWIN_EWOULDBLOCK = 35
const LINUX_EWOULDBLOCK = 11

export function lockDarwin(fd: number): LockResult {
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

export function lockLinux(fd: number): LockResult {
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
