// The bun runtime branch of "#stderr-capture": bind libc's dup/dup2 through
// bun:ffi and point fd 2 at the run's stderr log for the TUI's lifetime.
//
// The renderer owns the terminal surface while the TUI runs; when a native
// library or child prints to stderr (for example libasound reporting a failed
// audio probe), those lines paint directly over the rendered screen. Capturing
// stderr at the renderer scope keeps stray output in a log file instead.
import { dlopen } from "bun:ffi"
import { closeSync, mkdirSync, openSync, readFileSync } from "node:fs"
import { join } from "node:path"

export type StderrCapture = {
  readonly path: string
  restore(): void
}

const symbols = {
  close: { args: ["i32"], returns: "i32" },
  dup: { args: ["i32"], returns: "i32" },
  dup2: { args: ["i32", "i32"], returns: "i32" },
} as const

const staticCandidates = ["libc.so.6", "libc.so", "libc.dylib", "libSystem.B.dylib"]

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
  if (!process.stdout.isTTY && !process.stdin.isTTY) return undefined
  const libc = loadLibc()
  if (!libc) return undefined
  try {
    mkdirSync(dir, { recursive: true })
    const path = join(dir, "tui-stderr.log")
    const fd = openSync(path, "a")
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
    return {
      path,
      restore() {
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
