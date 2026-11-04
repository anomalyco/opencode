import { dlopen } from "bun:ffi"
import { spawn } from "bun-pty"
import type { Opts, Proc } from "./pty.js"

export type { Disp, Exit, Opts, Proc } from "./pty.js"

if (process.platform === "win32") {
  const library = dlopen("kernel32.dll", {
    SetConsoleCtrlHandler: { args: ["ptr", "i32"], returns: "i32" },
    GetLastError: { args: [], returns: "u32" },
  })
  try {
    // Detached servers start with Ctrl+C ignored, and ConPTY shells inherit it.
    // Clear that attribute once before spawning shells; keep registered handlers.
    if (library.symbols.SetConsoleCtrlHandler(null, 0) === 0)
      throw new Error(`Failed to enable PTY Ctrl+C handling: Windows error ${library.symbols.GetLastError()}`)
  } finally {
    library.close()
  }
}

function spawnPty(file: string, args: string[], opts: Opts): Proc {
  const pty = spawn(file, args, opts)
  return {
    pid: pty.pid,
    onData(listener) {
      return pty.onData(listener)
    },
    onExit(listener) {
      return pty.onExit(listener)
    },
    write(data) {
      pty.write(data)
    },
    resize(cols, rows) {
      pty.resize(cols, rows)
    },
    kill(signal) {
      pty.kill(signal)
    },
  }
}

export { spawnPty as spawn }
