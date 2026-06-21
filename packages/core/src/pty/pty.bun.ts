import { spawn as createBunPty } from "bun-pty"
import { spawn as createProcess } from "child_process"
import type { Opts, Proc } from "./pty"

export type { Disp, Exit, Opts, Proc } from "./pty"

const isTermux = process.env.PREFIX?.startsWith("/data/data/com.termux") ?? false

export function spawn(file: string, args: string[], opts: Opts): Proc {
  if (isTermux) {
    return spawnPipe(file, args, opts)
  }
  const pty = createBunPty(file, args, opts)
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

function spawnPipe(file: string, args: string[], opts: Opts): Proc {
  const env = { ...opts.env } as NodeJS.ProcessEnv
  if (!env.PWD && process.env.PWD) env.PWD = process.env.PWD
  const child = createProcess(file, args, {
    cwd: opts.cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  })

  const dataListeners = new Set<(data: string) => void>()
  const exitListeners = new Set<(event: { exitCode: number; signal?: string }) => void>()
  let killed = false

  if (child.stdout) {
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      for (const fn of dataListeners) fn(text)
    })
  }

  if (child.stderr) {
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      for (const fn of dataListeners) fn(text)
    })
  }

  child.on("exit", (exitCode, signal) => {
    killed = true
    for (const fn of exitListeners) fn({ exitCode: exitCode ?? 1, signal: signal ?? undefined })
  })

  child.on("error", () => {
    if (killed) return
    killed = true
    for (const fn of exitListeners) fn({ exitCode: 1 })
  })

  return {
    pid: child.pid ?? 0,
    onData(listener) {
      dataListeners.add(listener)
      return { dispose: () => dataListeners.delete(listener) }
    },
    onExit(listener) {
      exitListeners.add(listener)
      return { dispose: () => exitListeners.delete(listener) }
    },
    write(data) {
      if (child.stdin?.writable) child.stdin.write(data)
    },
    resize(cols, rows) {
      if (child.pid && !killed && cols > 0 && rows > 0) {
        try {
          process.kill(-child.pid, "SIGWINCH")
        } catch {}
      }
    },
    kill(signal) {
      killed = true
      if (child.pid) {
        try {
          process.kill(-child.pid, signal as any)
        } catch {
          child.kill(signal as any)
        }
      }
    },
  }
}
