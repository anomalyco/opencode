import type { Opts, Proc } from "./pty"
import { needsWindowsPipePtyFallback, spawnPipeFallback } from "./pty.compat"

export type { Disp, Exit, Opts, Proc } from "./pty"

// @ts-expect-error node-pty types are present but hidden behind package exports
const native = needsWindowsPipePtyFallback() ? null : (await import("@lydell/node-pty")) as typeof import("@lydell/node-pty")

export function spawn(file: string, args: string[], opts: Opts): Proc {
  if (!native) return spawnPipeFallback(file, args, opts)

  const proc = native.spawn(file, args, opts)
  return {
    pid: proc.pid,
    onData(listener) {
      return proc.onData(listener)
    },
    onExit(listener) {
      return proc.onExit(listener)
    },
    write(data) {
      proc.write(data)
    },
    resize(cols, rows) {
      proc.resize(cols, rows)
    },
    kill(signal) {
      proc.kill(signal)
    },
  }
}
