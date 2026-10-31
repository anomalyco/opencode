// The bun runtime branch of "#stderr-capture": bind libc's dup/dup2 through
// bun:ffi and point fd 2 at the run's stderr log for the TUI's lifetime.
//
// The renderer owns the terminal surface while the TUI runs; when a native
// library or child prints to stderr (for example libasound reporting a failed
// audio probe), those lines paint directly over the rendered screen. Capturing
// stderr at the renderer scope keeps stray output in a log file instead.
import { dlopen } from "bun:ffi"
import { closeSync, fstatSync, mkdirSync, openSync, readFileSync, renameSync, statSync } from "node:fs"
import { join } from "node:path"

export type StderrCapture = {
  readonly path: string
  readonly startSize: number
  restore(): void
}

const symbols = {
  close: { args: ["i32"], returns: "i32" },
  dup: { args: ["i32"], returns: "i32" },
  dup2: { args: ["i32", "i32"], returns: "i32" },
} as const

const staticCandidates = ["libc.so.6", "libc.so", "libc.dylib", "libSystem.B.dylib"]

// Every TUI shares one capture file, so bound it: once past this size the file
// is rotated aside at the start of a run rather than truncated.
const CAPTURE_MAX_BYTES = 10 * 1024 * 1024

function loadLibc(): ReturnType<typeof dlopen<typeof symbols>> | undefined {
  const candidates = new Set(staticCandidates)
  if (process.platform === "linux") {
    try {
      for (const line of readFileSync("/proc/self/maps", "utf8").split("\n"))
        for (const match of line.matchAll(/(\/[^\s ]*libc[^\s ]*\.so[^\s ]*)/g)) candidates.add(match[1])
    } catch {}
  }
  for (const candidate of candidates) {
    try {
      return dlopen(candidate, symbols)
    } catch {}
  }
  return undefined
}

export function captureStderr(dir: string): StderrCapture | undefined {
  if (process.env.OPENCODE_TUI_STDERR === "inherit") return undefined
  // Only stderr being the terminal matters: if the user already redirected
  // stderr (`opencode --print-logs 2>debug.log`), their redirect must keep
  // receiving the output instead of being moved into the capture file. When
  // stderr is not attached to a terminal there is no surface to paint over.
  if (!process.stderr.isTTY) return undefined
  const libc = loadLibc()
  if (!libc) return undefined
  try {
    mkdirSync(dir, { recursive: true })
    const path = join(dir, "tui-stderr.log")
    // Append rather than truncate per run: several TUIs can be open at once and
    // share this file, and O_APPEND writes interleave instead of overwriting at
    // independent offsets. Rotation (below, past CAPTURE_MAX_BYTES) replaces
    // the never-trimmed growth, and starting a run no longer wipes the capture
    // of a crashed run — the moment the user is most likely to read it. A run
    // holding the old inode keeps appending into the rotated copy.
    try {
      if (statSync(path).size > CAPTURE_MAX_BYTES) renameSync(path, `${path}.1`)
    } catch {
      // Missing file, or another TUI already rotated it; append to whatever is there.
    }
    const fd = openSync(path, "a")
    const startSize = fstatSync(fd).size
    // Take a fresh reference to fd 2 before dup2 clobbers it, to restore the
    // terminal stderr when the renderer scope ends.
    const saved = libc.symbols.dup(2)
    if (saved < 0) {
      closeSync(fd)
      return undefined
    }
    if (libc.symbols.dup2(fd, 2) < 0) {
      libc.symbols.close(saved)
      closeSync(fd)
      return undefined
    }
    let restored = false
    return {
      path,
      startSize,
      restore() {
        // acquireRelease fires this once per renderer scope; guard anyway so a
        // repeated call cannot dup2 or close a reused fd number.
        if (restored) return
        restored = true
        libc.symbols.dup2(saved, 2)
        libc.symbols.close(saved)
        closeSync(fd)
        libc.close()
      },
    }
  } catch {
    return undefined
  }
}
