import * as http from "node:http"
import * as tls from "node:tls"
import { Effect, Layer } from "effect"

type NodeTlsWithSystemCertificates = typeof tls & {
  getCACertificates: (type: "default" | "system") => string[]
  setDefaultCACertificates: (certificates: string[]) => void
}

type StartCommand = {
  type: "start"
  hostname: string
  port: number
  password: string
  userDataPath: string
  needsMigration: boolean
}

type StopCommand = { type: "stop" }
type SidecarCommand = StartCommand | StopCommand

type SidecarMessage =
  | { type: "sqlite"; progress: { type: "InProgress"; value: number } | { type: "Done" } }
  | { type: "ready" }
  | { type: "stopped" }
  | { type: "error"; error: { message: string; stack?: string } }

type ParentPort = {
  postMessage(message: SidecarMessage): void
  on(event: "message", listener: (event: { data: unknown }) => void): void
}

type Listener = {
  stop(close?: boolean): void | Promise<void>
}

const parentPort = getParentPort()
let listener: Listener | undefined
let fatalReported = false

process.on("unhandledRejection", (error) => {
  reportFatal("unhandledRejection", error)
})

process.on("uncaughtException", (error) => {
  reportFatal("uncaughtException", error)
})

parentPort.on("message", (event) => {
  const command = parseCommand(event.data)
  if (!command) return
  if (command.type === "stop") {
    void stop()
    return
  }
  void start(command)
})

async function start(command: StartCommand) {
  try {
    prepareSidecarEnv(command.password, command.userDataPath)
    ensureLoopbackNoProxy()
    useSystemCertificates()
    useEnvProxy()
    const { Database, Log, Server } = await import("virtual:opencode-server")
    await Log.init({ level: "WARN" })

    if (command.needsMigration) {
      parentPort.postMessage({ type: "sqlite", progress: { type: "InProgress", value: 0 } })
      await Effect.runPromise(Effect.scoped(Layer.build(Database.defaultLayer)))
      parentPort.postMessage({ type: "sqlite", progress: { type: "Done" } })
    }

    listener = await Server.listen({
      port: command.port,
      hostname: command.hostname,
      username: "opencode",
      password: command.password,
      cors: ["oc://renderer"],
    })
    parentPort.postMessage({ type: "ready" })
  } catch (error) {
    parentPort.postMessage({ type: "error", error: serializeError(error) })
    setImmediate(() => process.exit(1))
  }
}

async function stop() {
  try {
    await listener?.stop()
  } finally {
    listener = undefined
    parentPort.postMessage({ type: "stopped" })
    setImmediate(() => process.exit(0))
  }
}

function prepareSidecarEnv(password: string, userDataPath: string) {
  Object.assign(process.env, {
    OPENCODE_SERVER_USERNAME: "opencode",
    OPENCODE_SERVER_PASSWORD: password,
    OPENCODE_DISABLE_CHANNEL_DB: "true",
    XDG_STATE_HOME: process.env.XDG_STATE_HOME ?? userDataPath,
  })
}

function ensureLoopbackNoProxy() {
  const loopback = ["127.0.0.1", "localhost", "::1"]
  const upsert = (key: string) => {
    const items = (process.env[key] ?? "")
      .split(",")
      .map((value: string) => value.trim())
      .filter((value: string) => Boolean(value))

    for (const host of loopback) {
      if (items.some((value: string) => value.toLowerCase() === host)) continue
      items.push(host)
    }

    process.env[key] = items.join(",")
  }

  upsert("NO_PROXY")
  upsert("no_proxy")
}

function useSystemCertificates() {
  try {
    const nodeTls = tls as NodeTlsWithSystemCertificates
    nodeTls.setDefaultCACertificates([
      ...new Set([...nodeTls.getCACertificates("default"), ...nodeTls.getCACertificates("system")]),
    ])
  } catch (error) {
    console.warn("failed to load system certificates", error)
  }
}

function useEnvProxy() {
  try {
    callSetGlobalProxyFromEnv(http)
  } catch (error) {
    console.warn("failed to load proxy environment", error)
  }
}

function callSetGlobalProxyFromEnv(nodeHttp: object) {
  // Electron 41.2 runs Node 24.14.1; latest @types/node@24 is 24.12.2.
  const setGlobalProxyFromEnv: unknown = Reflect.get(nodeHttp, "setGlobalProxyFromEnv")
  if (typeof setGlobalProxyFromEnv !== "function") return
  setGlobalProxyFromEnv.call(nodeHttp)
}

function parseCommand(value: unknown): SidecarCommand | undefined {
  if (!value || typeof value !== "object") return undefined
  const command = value as Partial<StartCommand | StopCommand>
  if (command.type === "stop") return { type: "stop" }
  if (command.type !== "start") return undefined
  if (typeof command.hostname !== "string") return undefined
  if (typeof command.port !== "number") return undefined
  if (typeof command.password !== "string") return undefined
  if (typeof command.userDataPath !== "string") return undefined
  if (typeof command.needsMigration !== "boolean") return undefined
  return {
    type: "start",
    hostname: command.hostname,
    port: command.port,
    password: command.password,
    userDataPath: command.userDataPath,
    needsMigration: command.needsMigration,
  }
}

function serializeError(error: unknown) {
  if (error instanceof Error) return { message: error.message, stack: error.stack }
  return { message: String(error) }
}

function getParentPort() {
  const port = process.parentPort as ParentPort | undefined
  if (!port) throw new Error("Sidecar parent port unavailable")
  return port
}

function reportFatal(type: "uncaughtException" | "unhandledRejection", error: unknown) {
  if (fatalReported) return
  fatalReported = true
  const serialized = serializeError(error)
  const message = `sidecar ${type}: ${serialized.stack ?? serialized.message}`
  const fatalError = serialized.stack ? { message, stack: serialized.stack } : { message }
  try {
    parentPort.postMessage({ type: "error", error: fatalError })
  } catch {
    // Preserve the fatal path even if the Electron message port is already gone.
  }
  console.error(message)
  setImmediate(() => process.exit(1))
}
