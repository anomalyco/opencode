import type { Opts, Proc } from "./pty"
import { needsWindowsPipePtyFallback, spawnPipeFallback } from "./pty.compat"

export type { Disp, Exit, Opts, Proc } from "./pty"

const native = needsWindowsPipePtyFallback() ? null : await import("bun-pty")

export function spawn(file: string, args: string[], opts: Opts): Proc {
  if (!native) return spawnPipeFallback(file, args, opts)

  const pty = native.spawn(file, args, opts)
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
