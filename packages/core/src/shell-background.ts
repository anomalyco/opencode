export * as ShellBackground from "./shell-background"

import { ChildProcess } from "effect/unstable/process"
import { Shell } from "./shell"

export type Mode = boolean | "auto" | undefined

export type Resolution = {
  background: boolean
  mode: "foreground" | "manual" | "auto" | "config-auto"
}

const AUTO_PATTERNS = [
  /\b(?:docker\s+compose|docker-compose)\s+up\b(?!.*(?:\s-d\b|\s--detach\b))/i,
  /\b(?:docker|kubectl|journalctl|tail)\b.*(?:\s-f\b|\s--follow\b)/i,
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve|preview|watch)\b/i,
  /\b(?:vite|nodemon|pm2)\b/i,
  /\b(?:next|nuxt|astro|webpack|rollup|parcel)\b.*\b(?:dev|serve|preview|watch)\b/i,
  /\b(?:node|bun|tsc|swc|esbuild)\b.*\s--watch\b/i,
  /\bwatch(?:\s|$)/i,
]

const SUPERVISOR_SOURCE = String.raw`
const { spawn, execFile } = require("node:child_process")

const payload = JSON.parse(process.argv[process.argv.length - 1] ?? "{}")
const isWin = process.platform === "win32"
let shuttingDown = false
let finished = false

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return false
  }
}

function spawnChild() {
  if (payload.useShell === true) {
    return spawn(payload.command, [], {
      cwd: payload.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: payload.detached === true,
      shell: payload.shell,
      windowsHide: true,
    })
  }

  return spawn(payload.file, payload.args, {
    cwd: payload.cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: payload.detached === true,
    windowsHide: true,
  })
}

const child = spawnChild()

const forward = (source, sink) => {
  if (!source) return
  source.on("data", (chunk) => {
    try {
      sink.write(chunk)
    } catch {
      // ignore closed stdio during shutdown
    }
  })
}

forward(child.stdout, process.stdout)
forward(child.stderr, process.stderr)

const waitForExit = new Promise((resolve) => {
  child.once("exit", (code, signal) => {
    finished = true
    resolve({ code, signal })
  })
})

function killTree(signal) {
  return new Promise((resolve) => {
    if (!child.pid) {
      resolve()
      return
    }

    if (isWin) {
      execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => resolve())
      return
    }

    try {
      process.kill(-child.pid, signal)
      resolve()
      return
    } catch {}

    try {
      process.kill(child.pid, signal)
    } catch {}
    resolve()
  })
}

async function shutdown(reason) {
  if (shuttingDown) return
  shuttingDown = true
  clearInterval(parentWatch)
  await killTree("SIGTERM")
  const forced = setTimeout(() => {
    void killTree("SIGKILL")
  }, 3000)
  forced.unref?.()
  const result = await Promise.race([waitForExit, new Promise((resolve) => setTimeout(() => resolve(undefined), 3200))])
  clearTimeout(forced)
  if (reason === "natural" && result && typeof result.code === "number") {
    process.exit(result.code)
    return
  }
  if (reason === "natural" && result && result.signal) {
    process.kill(process.pid, result.signal)
    return
  }
  process.exit(0)
}

const parentWatch = setInterval(() => {
  if (finished) {
    clearInterval(parentWatch)
    return
  }
  if (!pidAlive(payload.parentPid)) {
    void shutdown("parent")
  }
}, 250)
parentWatch.unref?.()

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    void shutdown(signal)
  })
}

void waitForExit.then((result) => {
  if (shuttingDown) return
  clearInterval(parentWatch)
  if (typeof result.code === "number") {
    process.exit(result.code)
    return
  }
  if (result.signal) {
    process.kill(process.pid, result.signal)
    return
  }
  process.exit(0)
})
`

export function shouldAutoBackground(command: string) {
  const normalized = command.replace(/\s+/g, " ").trim()
  if (!normalized) return false
  return AUTO_PATTERNS.some((pattern) => pattern.test(normalized))
}

export function resolve(input: { command: string; requested?: Mode; configAuto?: boolean }): Resolution {
  if (input.requested === true) return { background: true, mode: "manual" }
  if (input.requested === false) return { background: false, mode: "foreground" }

  const auto = shouldAutoBackground(input.command)
  if (input.requested === "auto") {
    return auto ? { background: true, mode: "auto" } : { background: false, mode: "foreground" }
  }
  if (input.configAuto && auto) {
    return { background: true, mode: "config-auto" }
  }
  return { background: false, mode: "foreground" }
}

export function managedProcess(input: {
  shell: string
  command: string
  cwd: string
  env: NodeJS.ProcessEnv
  parentPID?: number
}) {
  const useShell = process.platform === "win32" && !Shell.ps(input.shell)
  const args =
    process.platform === "win32" && Shell.ps(input.shell)
      ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", input.command]
      : Shell.args(input.shell, input.command, input.cwd)
  const payload = JSON.stringify({
    parentPid: input.parentPID ?? process.pid,
    file: useShell ? undefined : input.shell,
    args: useShell ? undefined : args,
    cwd: input.cwd,
    shell: useShell ? input.shell : undefined,
    command: useShell ? input.command : undefined,
    useShell,
    detached: process.platform !== "win32",
  })
  return ChildProcess.make(process.execPath, ["-e", SUPERVISOR_SOURCE, payload], {
    cwd: input.cwd,
    env: input.env,
    stdin: "ignore",
    detached: process.platform !== "win32",
  })
}
