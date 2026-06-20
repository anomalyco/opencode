import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { app, utilityProcess } from "electron"
import type { Details } from "electron"
import { DEFAULT_SERVER_URL_KEY, WSL_ENABLED_KEY } from "./constants"
import { createSidecarEnv, sidecarDefaultCwd } from "./server-env"
import { getUserShell, loadShellEnv } from "./shell-env"
import { getStore } from "./store"
import type { SqliteMigrationProgress } from "../preload/types"

export type WslConfig = { enabled: boolean }

export type HealthCheck = { wait: Promise<void> }

type SidecarMessage =
  | { type: "sqlite"; progress: SqliteMigrationProgress }
  | { type: "ready" }
  | { type: "stopped" }
  | { type: "error"; error: { message: string; stack?: string } }

export type SidecarListener = { stop: () => Promise<void> }

type SidecarStream = {
  on(event: "data", listener: (chunk: Buffer) => void): unknown
}

type SidecarProcess = {
  stdout?: SidecarStream | null
  stderr?: SidecarStream | null
  on(event: "message", listener: (message: SidecarMessage) => void): unknown
  on(event: "error", listener: (error: unknown) => void): unknown
  on(event: "exit", listener: (code: number) => void): unknown
  once(event: "exit", listener: (code: number) => void): unknown
  off(event: "message", listener: (message: SidecarMessage) => void): unknown
  off(event: "exit", listener: (code: number) => void): unknown
  postMessage(message: unknown): void
  kill(): void
}

type DesktopAppEvents = {
  on(event: "child-process-gone", listener: (event: unknown, details: Details) => void): unknown
  off(event: "child-process-gone", listener: (event: unknown, details: Details) => void): unknown
}

type SpawnLocalServerDeps = {
  app: DesktopAppEvents
  forkSidecar: (sidecar: string, cwd: string) => SidecarProcess
  makeDirectory: typeof mkdir
  sidecarPath: string
  checkHealth: (url: string, password?: string | null) => Promise<boolean>
  delay: (ms: number) => Promise<void>
  startStallTimeout: number
  stopTimeout: number
}

const SIDECAR_SERVICE_NAME = "opencode server"
const SIDECAR_START_STALL_TIMEOUT = 60_000
const SIDECAR_STOP_TIMEOUT = 6_000

type SpawnLocalServerOptions = {
  needsMigration: boolean
  userDataPath: string
  onSqliteProgress?: (progress: SqliteMigrationProgress) => void
  onStdout?: (message: string) => void
  onStderr?: (message: string) => void
  onExit?: (code: number) => void
  onUnexpectedExit?: (code: number) => void
}

export function getDefaultServerUrl(): string | null {
  const value = getStore().get(DEFAULT_SERVER_URL_KEY)
  return typeof value === "string" ? value : null
}

export function setDefaultServerUrl(url: string | null) {
  if (url) {
    getStore().set(DEFAULT_SERVER_URL_KEY, url)
    return
  }

  getStore().delete(DEFAULT_SERVER_URL_KEY)
}

export function getWslConfig(): WslConfig {
  const value = getStore().get(WSL_ENABLED_KEY)
  return { enabled: typeof value === "boolean" ? value : false }
}

export function setWslConfig(config: WslConfig) {
  getStore().set(WSL_ENABLED_KEY, config.enabled)
}

export function preferAppEnv(userDataPath: string) {
  const shell = process.platform === "win32" ? null : getUserShell()
  Object.assign(process.env, {
    ...(shell ? loadShellEnv(shell) : null),
    OPENCODE_EXPERIMENTAL_ICON_DISCOVERY: "true",
    OPENCODE_EXPERIMENTAL_FILEWATCHER: "true",
    OPENCODE_CLIENT: "desktop",
    XDG_STATE_HOME: process.env.XDG_STATE_HOME ?? userDataPath,
  })
}

export function createSpawnLocalServer(deps: SpawnLocalServerDeps) {
  return async function spawnLocalServer(
    hostname: string,
    port: number,
    password: string,
    options: SpawnLocalServerOptions,
  ) {
    const sidecar = deps.sidecarPath
    const cwd = sidecarDefaultCwd(options.userDataPath)
    await deps.makeDirectory(cwd, { recursive: true })
    const child = deps.forkSidecar(sidecar, cwd)
    let exited = false
    let expectedExit = false
    let ready = false
    const exit = defer<number>()

    const onRuntimeMessage = (message: SidecarMessage) => {
      if (message.type !== "error") return
      options.onStderr?.(`sidecar error: ${formatSidecarError(message.error)}`)
    }

    const onProcessGone = (_event: unknown, details: Details) => {
      if (details.type !== "Utility" || details.name !== SIDECAR_SERVICE_NAME) return
      options.onStderr?.(`utility process gone reason=${details.reason} exitCode=${details.exitCode}`)
    }

    deps.app.on("child-process-gone", onProcessGone)
    child.on("message", onRuntimeMessage)
    child.once("exit", (code) => {
      exited = true
      deps.app.off("child-process-gone", onProcessGone)
      child.off("message", onRuntimeMessage)
      options.onExit?.(code)
      if (ready && !expectedExit) options.onUnexpectedExit?.(code)
      exit.resolve(code)
    })
    child.on("error", (error) => options.onStderr?.(`utility process error: ${serializeError(error).message}`))

    child.stdout?.on("data", (chunk: Buffer) => options.onStdout?.(chunk.toString("utf8").trimEnd()))
    child.stderr?.on("data", (chunk: Buffer) => options.onStderr?.(chunk.toString("utf8").trimEnd()))

    await new Promise<void>((resolve, reject) => {
      let done = false
      let timeout: NodeJS.Timeout

      const fail = (error: Error) => {
        if (done) return
        done = true
        cleanup()
        reject(error)
      }

      const refreshTimeout = () => {
        clearTimeout(timeout)
        timeout = setTimeout(() => {
          fail(new Error(`Sidecar did not become ready within ${deps.startStallTimeout}ms: ${sidecar}`))
        }, deps.startStallTimeout)
      }

      const onMessage = (message: SidecarMessage) => {
        if (message.type === "sqlite") {
          refreshTimeout()
          options.onSqliteProgress?.(message.progress)
          return
        }
        if (message.type === "ready") {
          if (done) return
          done = true
          ready = true
          cleanup()
          resolve()
          return
        }
        if (message.type === "error") {
          fail(Object.assign(new Error(message.error.message), { stack: message.error.stack }))
        }
      }
      const onExit = (code: number) => {
        fail(new Error(`Sidecar exited before ready with code ${code}`))
      }
      const cleanup = () => {
        clearTimeout(timeout)
        child.off("message", onMessage)
        child.off("exit", onExit)
      }

      child.on("message", onMessage)
      child.on("exit", onExit)
      refreshTimeout()
      child.postMessage({
        type: "start",
        hostname,
        port,
        password,
        userDataPath: options.userDataPath,
        needsMigration: options.needsMigration,
      })
    }).catch((error) => {
      if (!exited) child.kill()
      throw error
    })

    const wait = (async () => {
      const url = `http://${hostname}:${port}`
      let healthy = false
      const gone = exit.promise.then((code) => {
        if (healthy) return
        throw new Error(`Sidecar exited before health check passed with code ${code}`)
      })

      const ready = async () => {
        while (true) {
          await new Promise((resolve) => setTimeout(resolve, 100))
          if (await deps.checkHealth(url, password)) {
            healthy = true
            return
          }
        }
      }

      await Promise.race([ready(), gone])
    })()

    let stopping: Promise<void> | undefined

    return {
      listener: {
        stop: () => {
          if (stopping) return stopping
          if (exited) return Promise.resolve()
          expectedExit = true
          child.postMessage({ type: "stop" })
          stopping = Promise.race([
            exit.promise.then(() => undefined),
            deps.delay(deps.stopTimeout).then(() => {
              if (!exited) child.kill()
            }),
          ])
          return stopping
        },
      },
      health: { wait },
    }
  }
}

export const spawnLocalServer = createSpawnLocalServer({
  app,
  forkSidecar: (sidecar, cwd) =>
    utilityProcess.fork(sidecar, [], {
      cwd,
      env: createSidecarEnv({ cwd }),
      serviceName: SIDECAR_SERVICE_NAME,
      stdio: "pipe",
    }),
  makeDirectory: mkdir,
  sidecarPath: join(dirname(fileURLToPath(import.meta.url)), "sidecar.js"),
  checkHealth,
  delay,
  startStallTimeout: SIDECAR_START_STALL_TIMEOUT,
  stopTimeout: SIDECAR_STOP_TIMEOUT,
})

export async function checkHealth(url: string, password?: string | null): Promise<boolean> {
  let healthUrl: URL
  try {
    healthUrl = new URL("/global/health", url)
  } catch {
    return false
  }

  const headers = new Headers()
  if (password) {
    const auth = Buffer.from(`opencode:${password}`).toString("base64")
    headers.set("authorization", `Basic ${auth}`)
  }

  try {
    const res = await fetch(healthUrl, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function serializeError(error: unknown) {
  if (error instanceof Error) return { message: error.message, stack: error.stack }
  return { message: String(error) }
}

function formatSidecarError(error: { message: string; stack?: string }) {
  return error.stack ?? error.message
}

function defer<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
