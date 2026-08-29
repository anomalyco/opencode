import { dlopen } from "bun:ffi"
import fs from "fs"
import { ReadStream } from "node:tty"

export const INTERACTIVE_INPUT_REASON = "requires a controlling terminal for input"

type InteractiveStdin = {
  stdin: NodeJS.ReadStream
  cleanup?: () => void
}

function openTerminalStdin(path: string): NodeJS.ReadStream {
  return new ReadStream(fs.openSync(path, "r"))
}

const duplicates = new Map<NodeJS.Platform, (fd: number) => number>()

function duplicate(fd: number, platform: NodeJS.Platform) {
  const cached = duplicates.get(platform)
  if (cached) return cached(fd)
  if (platform === "win32") {
    const library = dlopen("ucrtbase.dll", { _dup2: { args: ["i32", "i32"], returns: "i32" } })
    const value = (source: number) => library.symbols._dup2(source, 0)
    duplicates.set(platform, value)
    return value(fd)
  }
  const library = dlopen(platform === "darwin" ? "libSystem.B.dylib" : "libc.so.6", {
    dup2: { args: ["i32", "i32"], returns: "i32" },
  })
  const value = (source: number) => library.symbols.dup2(source, 0)
  duplicates.set(platform, value)
  return value(fd)
}

function redirectStdin(_stdin: NodeJS.ReadStream, path: string, platform: NodeJS.Platform) {
  const fd = fs.openSync(path, "r")
  try {
    const result = duplicate(fd, platform)
    if (result !== 0) throw new Error(`Failed to redirect stdin: ${result}`)
  } finally {
    fs.closeSync(fd)
  }
}

export function resolveInteractiveStdin(
  stdin: NodeJS.ReadStream = process.stdin,
  open: (path: string) => NodeJS.ReadStream = openTerminalStdin,
  platform = process.platform,
  redirect: (stdin: NodeJS.ReadStream, path: string, platform: NodeJS.Platform) => void = redirectStdin,
): InteractiveStdin {
  const terminal = platform === "win32" ? "CONIN$" : "/dev/tty"
  const ignored = platform === "win32" ? "NUL" : "/dev/null"

  try {
    const stream = open(terminal)
    try {
      redirect(stdin, ignored, platform)
    } catch (error) {
      stream.destroy()
      throw error
    }
    return {
      stdin: stream,
      cleanup: () => {
        stream.destroy()
      },
    }
  } catch (error) {
    throw new Error(INTERACTIVE_INPUT_REASON, { cause: error })
  }
}
