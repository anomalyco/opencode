export * as WatcherInotify from "./watcher-inotify"

import { dlopen, FFIType, read } from "bun:ffi"
import os from "os"
import { lazy } from "../util/lazy"

declare const OPENCODE_LIBC: string | undefined

// The flags @parcel/watcher's InotifyBackend passes to inotify_init1. Probing
// with any other flags would not prove that the real call can succeed.
const IN_NONBLOCK = 0o4000
const IN_CLOEXEC = 0o2000000

export interface ProbeFailure {
  readonly errno: number
  readonly code: string
}

const errnoCodes = Object.entries(os.constants.errno)

const libc = lazy(() => {
  const musl = `libc.musl-${process.arch === "arm64" ? "aarch64" : "x86_64"}.so.1`
  const glibc = "libc.so.6"
  const preferred = (typeof OPENCODE_LIBC === "undefined" ? undefined : OPENCODE_LIBC) === "musl" ? musl : glibc
  for (const candidate of [preferred, preferred === musl ? glibc : musl, "libc.so"]) {
    try {
      return dlopen(candidate, {
        inotify_init1: { args: [FFIType.i32], returns: FFIType.i32 },
        close: { args: [FFIType.i32], returns: FFIType.i32 },
        __errno_location: { args: [], returns: FFIType.ptr },
      }).symbols
    } catch {
      continue
    }
  }
  return
})

/**
 * Ask the kernel for one inotify instance and immediately give it back.
 *
 * `@parcel/watcher` builds its shared inotify backend inside the synchronous
 * constructor of the N-API `SubscribeRunner`, on whichever thread called
 * `subscribe()`. When `inotify_init1` fails there, `InotifyBackend::start()`
 * throws before `notifyStarted()`, and `Backend::handleError()` only notifies
 * already-registered watchers - so `Backend::run()` keeps waiting on
 * `mStartedSignal` and the calling thread never returns. For opencode that
 * thread is the JS main thread, which parks the event loop permanently: no
 * timer, no fiber and no interrupt can run afterwards, which is why the failure
 * produced neither a log line nor an abortable turn.
 *
 * Returning the errno instead of a boolean keeps the caller honest: EMFILE can
 * mean either the per-process descriptor limit or the per-uid
 * `fs.inotify.max_user_instances` ceiling, and this cannot tell them apart.
 *
 * Returns `undefined` when an instance is obtainable, or when the probe itself
 * cannot run (no `bun:ffi`, no libc, missing symbols). An unprobeable runtime
 * keeps the pre-existing behaviour rather than silently losing file watching.
 */
export function probe(): ProbeFailure | undefined {
  const symbols = libc()
  if (!symbols) return

  const fd = symbols.inotify_init1(IN_NONBLOCK | IN_CLOEXEC)
  if (fd !== -1) {
    symbols.close(fd)
    return
  }

  // errno is thread-local and is clobbered by the next failing libc call, so it
  // has to be read before anything else happens on this thread.
  const location = symbols.__errno_location()
  const errno = location ? read.i32(location) : 0
  const code = errnoCodes.find(([, value]) => value === errno)
  return { errno, code: code ? code[0] : "UNKNOWN" }
}
