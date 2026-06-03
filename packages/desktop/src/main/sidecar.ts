import { execFile, spawn } from "node:child_process"
import { existsSync, statSync } from "node:fs"
import * as http from "node:http"
import { resolve } from "node:path"
import * as tls from "node:tls"

type NodeHttpWithEnvProxy = typeof http & {
  setGlobalProxyFromEnv: () => void
}

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
}

type StopCommand = { type: "stop" }
type SidecarCommand = StartCommand | StopCommand

type SidecarMessage =
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
const server = { proc: undefined as ReturnType<typeof spawn> | undefined }

parentPort.on("message", (event) => {
  const command = parseCommand(event.data)
  if (!command) return
  if (command.type === "stop") {
    void stop()
    return
  }
  void start(command)
})

async function spawnServer(exe: string, args: string[]): Promise<boolean> {
  return new Promise((done) => {
    const proc = spawn(exe, args, { stdio: ["ignore", "pipe", "pipe"] })
    server.proc = proc
    proc.stdout?.on("data", (chunk: Buffer) => {
      const line = chunk.toString()
      process.stdout.write(line)
      if (line.includes("server listening")) {
        parentPort.postMessage({ type: "ready" })
        done(true)
      }
    })
    proc.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk))
    proc.on("exit", (code) => {
      done(false)
      if (code === 0 || code === null) return
      parentPort.postMessage({ type: "error", error: { message: `server exited with code ${code}` } })
      setImmediate(() => process.exit(1))
    })
    proc.on("error", () => done(false))
  })
}

async function start(command: StartCommand) {
  try {
    prepareSidecarEnv(command.password, command.userDataPath)
    ensureLoopbackNoProxy()

    const bin = resolve(__dirname, `../../../opencode${process.platform === "win32" ? ".exe" : ""}`)
    if (existsSync(bin) && statSync(bin).isFile() && (await spawnServer(bin, ["serve", "--port", String(command.port), "--hostname", command.hostname]))) return

    const entry = resolve(__dirname, "../../../opencode/src/index.ts")
    const bunBin = process.env.BUN_PATH || (await findBun())
    if (bunBin && existsSync(entry) && (await spawnServer(bunBin, [entry, "serve", "--port", String(command.port), "--hostname", command.hostname]))) return

    useSystemCertificates()
    useEnvProxy()
    const { Log, Server } = await import("virtual:opencode-server")
    await Log.init({ level: "WARN" })

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
    server.proc?.kill()
    server.proc = undefined
    await listener?.stop()
  } finally {
    listener = undefined
    parentPort.postMessage({ type: "stopped" })
    setImmediate(() => process.exit(0))
  }
}

async function findBun(): Promise<string | undefined> {
  const found = ["/usr/bin/bun", "/usr/local/bin/bun", `${process.env.HOME}/.bun/bin/bun`].find(existsSync)
  if (found) return found
  return new Promise<string | undefined>((done) => {
    execFile("which", ["bun"], { encoding: "utf8" }, (err, stdout) => {
      done(err ? undefined : stdout.trim() || undefined)
    })
  })
}

function prepareSidecarEnv(password: string, userDataPath: string) {
  Object.assign(process.env, {
    OPENCODE_SERVER_USERNAME: "opencode",
    OPENCODE_SERVER_PASSWORD: password,
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
    ;(http as NodeHttpWithEnvProxy).setGlobalProxyFromEnv()
  } catch (error) {
    console.warn("failed to load proxy environment", error)
  }
}

function parseCommand(value: unknown): SidecarCommand | undefined {
  if (!value || typeof value !== "object") return
  const command = value as Partial<StartCommand | StopCommand>
  if (command.type === "stop") return { type: "stop" }
  if (command.type !== "start") return
  if (typeof command.hostname !== "string") return
  if (typeof command.port !== "number") return
  if (typeof command.password !== "string") return
  if (typeof command.userDataPath !== "string") return
  return {
    type: "start",
    hostname: command.hostname,
    port: command.port,
    password: command.password,
    userDataPath: command.userDataPath,
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
