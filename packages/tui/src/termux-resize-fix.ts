import type { CliRenderer } from "@opentui/core"

// Termux + proot never delivers SIGWINCH to the process, so the OpenTUI
// renderer sticks to the startup terminal size forever (soft keyboard covers
// the lower half / no reflow on rotate). Poll ioctl(TIOCGWINSZ) for the real
// size and, on change, both call renderer.resize() AND deliver a self-SIGWINCH
// (the handler path verified to actually reflow OpenTUI under proot).
const TIOCGWINSZ = 0x5413

let ioctlFn:
  | ((fd: number, request: number, arg: unknown) => number)
  | undefined
let ffiPtr: ((buffer: ArrayBufferView) => unknown) | undefined

async function initIoctl(): Promise<void> {
  try {
    const ffi = await import("bun:ffi")
    for (const candidate of [
      "/lib/aarch64-linux-gnu/libc.so.6",
      "/lib/x86_64-linux-gnu/libc.so.6",
      "/usr/lib/x86_64-linux-gnu/libc.so.6",
      "/lib/arm-linux-gnueabihf/libc.so.6",
      "libc.so.6",
    ]) {
      try {
        const lib = ffi.dlopen(candidate, {
          ioctl: { args: ["int", "int", "ptr"], returns: "int" },
        })
        ioctlFn = lib.symbols.ioctl as unknown as (fd: number, request: number, arg: unknown) => number
        ffiPtr = ffi.ptr as unknown as (buffer: ArrayBufferView) => unknown
        return
      } catch {
        // try next candidate
      }
    }
  } catch {
    // bun:ffi unavailable
  }
}

function readSize(): string | undefined {
  if (!ioctlFn || !ffiPtr) {
    return undefined
  }
  for (const fd of [process.stdout.fd, 1, 0] as number[]) {
    if (typeof fd !== "number" || fd < 0) {
      continue
    }
    try {
      const winsize = new Uint16Array(4)
      const rc = ioctlFn(fd, TIOCGWINSZ, ffiPtr(winsize))
      if (rc < 0) {
        continue
      }
      if (winsize[0] > 0 && winsize[1] > 0) {
        return `${winsize[1]}x${winsize[0]}`
      }
    } catch {
      // try next fd
    }
  }
  return undefined
}

export function startTermuxResizeFix(renderer: CliRenderer): () => void {
  void initIoctl()
  let lastSize: string | undefined
  const timer = setInterval(() => {
    if (renderer.isDestroyed) {
      return
    }
    const size = readSize()
    if (!size || size === lastSize) {
      return
    }
    lastSize = size
    const [cols, rows] = size.split("x").map(Number)
    try {
      renderer.resize(cols, rows)
    } catch {
      // ignore
    }
    try {
      process.kill(process.pid, "SIGWINCH")
    } catch {
      // ignore
    }
  }, 300)
  return () => clearInterval(timer)
}
