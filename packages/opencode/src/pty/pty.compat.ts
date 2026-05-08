import { spawn as createChild } from "node:child_process"
import os from "node:os"
import type { Exit, Opts, Proc } from "./pty"

const MIN_CONPTY_BUILD = 17763

export function needsWindowsPipePtyFallback(platform = process.platform, release = os.release()) {
  if (platform !== "win32") return false
  const build = Number.parseInt(release.split(".").at(-1) ?? "", 10)
  return !Number.isFinite(build) || build < MIN_CONPTY_BUILD
}

export function spawnPipeFallback(file: string, args: string[], opts: Opts): Proc {
  const child = createChild(file, args, {
    cwd: opts.cwd,
    env: opts.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  })
  const output = new Set<(data: string) => void>()
  const exits = new Set<(event: Exit) => void>()
  let settled = false

  const emitData = (chunk: string | Buffer | null | undefined) => {
    if (chunk == null) return
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8")
    output.forEach((listener) => listener(text))
  }

  const emitExit = (event: Exit) => {
    if (settled) return
    settled = true
    exits.forEach((listener) => listener(event))
  }

  child.stdout?.on("data", emitData)
  child.stderr?.on("data", emitData)
  child.on("error", (error) => {
    emitData(`${error.message}\r\n`)
    emitExit({ exitCode: 1 })
  })
  child.on("exit", (exitCode, signal) => {
    emitExit({
      exitCode: exitCode ?? 0,
      signal: signal ?? undefined,
    })
  })

  return {
    pid: child.pid ?? -1,
    onData(listener) {
      output.add(listener)
      return {
        dispose() {
          output.delete(listener)
        },
      }
    },
    onExit(listener) {
      exits.add(listener)
      return {
        dispose() {
          exits.delete(listener)
        },
      }
    },
    write(data) {
      child.stdin?.write(data)
    },
    resize() {},
    kill(signal) {
      if (process.platform === "win32") {
        child.kill()
        return
      }
      child.kill(signal as NodeJS.Signals | number | undefined)
    },
  }
}
