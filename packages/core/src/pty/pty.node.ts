import * as pty from "@lydell/node-pty"
import { hostSpawn } from "../flatpak"
import type { Opts, Proc } from "./pty"

export type { Disp, Exit, Opts, Proc } from "./pty"

export function spawn(file: string, args: string[], opts: Opts): Proc {
  const host = hostSpawn(file, args, { cwd: opts.cwd })
  const proc = pty.spawn(host.command, host.args, {
    ...opts,
    ...(process.platform === "win32" ? { useConptyDll: true } : {}),
  })
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
