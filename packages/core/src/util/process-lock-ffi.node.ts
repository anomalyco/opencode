import { dlopen, getInt32 } from "node:ffi"

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
    flock: { arguments: ["int32", "int32"], return: "int32" },
    __error: { arguments: [], return: "pointer" },
  })
  try {
    const result = library.functions.flock(fd, LOCK_EX | LOCK_NB)
    const code = result === 0 ? 0 : getInt32(library.functions.__error(), 0)
    if (result === 0) return { acquired: true }
    if (code === DARWIN_EWOULDBLOCK) return { acquired: false, held: true }
    return { acquired: false, held: false, code }
  } finally {
    library.lib.close()
  }
}

export function lockLinux(fd: number): LockResult {
  const library = dlopen("libc.so.6", {
    flock: { arguments: ["int32", "int32"], return: "int32" },
    __errno_location: { arguments: [], return: "pointer" },
  })
  try {
    const result = library.functions.flock(fd, LOCK_EX | LOCK_NB)
    const code = result === 0 ? 0 : getInt32(library.functions.__errno_location(), 0)
    if (result === 0) return { acquired: true }
    if (code === LINUX_EWOULDBLOCK) return { acquired: false, held: true }
    return { acquired: false, held: false, code }
  } finally {
    library.lib.close()
  }
}
