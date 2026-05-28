import { drizzle } from "drizzle-orm/node-sqlite/driver"
import * as http from "node:http"
import * as tls from "node:tls"
import { platform } from "node:os"
import { exec } from "node:child_process"
import { watch } from "node:fs"

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
    console.info('[sidecar] Calling useSystemCertificates()')
    useSystemCertificates()
    console.info('[sidecar] Finished useSystemCertificates()')
    useEnvProxy()
    const { Database, JsonMigration, Log, Server } = await import("virtual:opencode-server")
    await Log.init({ level: "WARN" })

    if (command.needsMigration) {
      await JsonMigration.run(drizzle({ client: Database.Client().$client }), {
        progress: (event: { current: number; total: number }) => {
          parentPort.postMessage({
            type: "sqlite",
            progress: {
              type: "InProgress",
              value: event.total === 0 ? 100 : Math.round((event.current / event.total) * 100),
            },
          })
        },
      })
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
  const plt = platform()
  console.info(`[sidecar] useSystemCertificates() platform: ${plt}`)
  if (plt === "darwin") {
    console.info('[sidecar] Loading and watching macOS system CAs')
    loadAndWatchMacSystemCAs()
    return
  }
  if (plt === "win32") {
    console.info('[sidecar] Loading and watching Windows system CAs')
    loadAndWatchWindowsSystemCAs()
    return
  }
  if (plt === "linux") {
    console.info('[sidecar] Loading and watching Linux system CAs')
    loadAndWatchLinuxSystemCAs()
    return
  }
  try {
    const nodeTls = tls as NodeTlsWithSystemCertificates
    const defaultCAs = nodeTls.getCACertificates("default")
    const systemCAs = nodeTls.getCACertificates("system")
    console.info(`[sidecar] Default CAs: ${defaultCAs.length}, System CAs: ${systemCAs.length}`)
    nodeTls.setDefaultCACertificates([
      ...new Set([
        ...defaultCAs,
        ...systemCAs,
      ]),
    ])
    console.info(`[sidecar] Set default CA certificates: ${defaultCAs.length + systemCAs.length}`)
  } catch (error) {
    console.warn("failed to load system certificates", error)
  }
}
// --- Windows system trust integration ---
function loadAndWatchWindowsSystemCAs() {
  loadWindowsSystemCAs()
  // No direct file to watch; poll every 60s
  setInterval(loadWindowsSystemCAs, 60000)
}

function loadWindowsSystemCAs() {
  console.info('[sidecar] Loading Windows system CAs')
  exec(
    'certutil -store -user Root',
    (err, stdout, stderr) => {
      if (err) {
        console.warn("failed to extract Windows system CAs", err, stderr)
        return
      }
      try {
        // Extract PEM blocks from certutil output
        const matches = stdout.match(/-----BEGIN CERTIFICATE-----[^-]+-----END CERTIFICATE-----/g)
        const systemCAs = matches ? matches.map((block) => block.trim()) : []
        const nodeTls = tls as NodeTlsWithSystemCertificates
        const defaultCAs = nodeTls.getCACertificates("default")
        console.info(`[sidecar] Windows: defaultCAs=${defaultCAs.length}, systemCAs=${systemCAs.length}`)
        nodeTls.setDefaultCACertificates([...new Set([...defaultCAs, ...systemCAs])])
        console.info(`[sidecar] Windows system trust store loaded (${systemCAs.length} certs)`)
      } catch (e) {
        console.warn("failed to set Windows system CAs", e)
      }
    }
  )
}

// --- Linux system trust integration ---
const LINUX_CA_PATHS = [
  "/etc/ssl/certs/ca-certificates.crt", // Debian/Ubuntu/Gentoo etc.
  "/etc/pki/tls/certs/ca-bundle.crt",   // Fedora/RHEL 6
  "/etc/ssl/ca-bundle.pem",             // OpenSUSE
  "/etc/pki/tls/cacert.pem",            // OpenELEC
  "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem", // CentOS/RHEL 7
]

function loadAndWatchLinuxSystemCAs() {
  loadLinuxSystemCAs()
  for (const path of LINUX_CA_PATHS) {
    try {
      watch(path, { persistent: false }, () => {
        loadLinuxSystemCAs()
      })
    } catch (err) {
      // ignore
    }
  }
}

function loadLinuxSystemCAs() {
  const fs = require("fs")
  let found = false
  for (const path of LINUX_CA_PATHS) {
    try {
      if (fs.existsSync(path)) {
        const pem = fs.readFileSync(path, "utf8")
        const systemCAs = pem
          .split(/(?=-----BEGIN CERTIFICATE-----)/g)
          .map((block: string) => block.trim())
          .filter((block: string) => block.startsWith("-----BEGIN CERTIFICATE-----"))
        const nodeTls = tls as NodeTlsWithSystemCertificates
        const defaultCAs = nodeTls.getCACertificates("default")
        console.info(`[sidecar] Linux: defaultCAs=${defaultCAs.length}, systemCAs=${systemCAs.length} from ${path}`)
        nodeTls.setDefaultCACertificates([...new Set([...defaultCAs, ...systemCAs])])
        console.info(`[sidecar] Linux system trust store loaded (${systemCAs.length} certs from ${path})`)
        found = true
        break
      }
    } catch (e) {
      // ignore
    }
  }
  if (!found) {
    console.warn("No Linux CA bundle found in known paths.")
  }
}

// --- macOS system trust integration ---
const MACOS_KEYCHAIN_PATHS = [
  "/System/Library/Keychains/SystemRootCertificates.keychain",
  "/Library/Keychains/System.keychain",
]

function loadAndWatchMacSystemCAs() {
  loadMacSystemCAs()
  for (const path of MACOS_KEYCHAIN_PATHS) {
    try {
      watch(path, { persistent: false }, () => {
        console.info(`[sidecar] Detected change in macOS keychain: ${path}, reloading system CAs`)
        loadMacSystemCAs()
      })
    } catch (err) {
      // ignore
    }
  }
}

function loadMacSystemCAs() {
  console.info('[sidecar] Loading macOS system CAs')
  exec(
    'security find-certificate -a -p ' + MACOS_KEYCHAIN_PATHS.join(' '),
    (err, stdout, stderr) => {
      if (err) {
        console.warn("failed to extract macOS system CAs", err, stderr)
        return
      }
      try {
        const nodeTls = tls as NodeTlsWithSystemCertificates
        // Merge with Node's default CAs
        const defaultCAs = nodeTls.getCACertificates("default")
        const systemCAs = stdout
          .split(/(?=-----BEGIN CERTIFICATE-----)/g)
          .map((block) => block.trim())
          .filter((block) => block.startsWith("-----BEGIN CERTIFICATE-----"))
        console.info(`[sidecar] macOS: defaultCAs=${defaultCAs.length}, systemCAs=${systemCAs.length}`)
        nodeTls.setDefaultCACertificates([...new Set([...defaultCAs, ...systemCAs])])
        console.info(`[sidecar] macOS system trust store loaded (${systemCAs.length} certs)`)
      } catch (e) {
        console.warn("failed to set macOS system CAs", e)
      }
    }
  )
}

function useEnvProxy() {
  try {
    ; (http as NodeHttpWithEnvProxy).setGlobalProxyFromEnv()
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
  if (typeof command.needsMigration !== "boolean") return
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
