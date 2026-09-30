import { TerminalTray } from "@opencode/schema/terminal-tray"
import type { Endpoint } from "@opencode/client/service"
import { Option, Schema } from "effect"
import { createServer } from "node:http"
import { randomUUID } from "node:crypto"
import { mkdir, open, rm, writeFile, access } from "node:fs/promises"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn, execFile } from "node:child_process"

const decodeCommand = Schema.decodeUnknownOption(Schema.fromJsonString(TerminalTray.Command))

export function hasDesktop(env: NodeJS.ProcessEnv, platform: string, tty: boolean) {
  if (!tty || env.OPENCODE_TRAY === "0" || env.OPENCODE_TRAY === "false") return false
  if (env.SSH_CONNECTION || env.SSH_TTY) return false
  return platform === "darwin" || platform === "win32" || !!(env.DISPLAY || env.WAYLAND_DISPLAY)
}

export async function createTerminalTray(input: {
  endpoint: Endpoint
  directory: string
  enabled: boolean
  launch: (file: string) => Promise<void>
  focus: () => void
  log: (message: string, error: unknown) => void
}) {
  const token = randomUUID()
  const state = {
    value: { enabled: false, focused: true, sessions: [] } as TerminalTray.State,
    endpoint: input.endpoint,
  }
  const listeners = new Set<(command: TerminalTray.Command) => void>()
  const pending: TerminalTray.Command[] = []
  const server = createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401).end()
      return
    }
    if (request.method === "GET" && request.url === "/state") {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
      response.end(JSON.stringify({ ...state.value, server: state.endpoint } satisfies TerminalTray.Snapshot))
      return
    }
    if (request.method !== "POST" || request.url !== "/command") {
      response.writeHead(404).end()
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    request.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > 16_384) {
        response.writeHead(413).end()
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on("end", () => {
      const command = Option.getOrUndefined(decodeCommand(Buffer.concat(chunks).toString("utf8")))
      if (!command) {
        response.writeHead(400).end()
        return
      }
      input.focus()
      if (!listeners.size) pending.push(command)
      listeners.forEach((listener) => listener(command))
      response.writeHead(204).end()
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Terminal tray bridge did not bind a TCP port")
  const connection: TerminalTray.Connection = { id: randomUUID(), url: `http://127.0.0.1:${address.port}`, token }
  await mkdir(input.directory, { recursive: true, mode: 0o700 })
  const file = join(input.directory, `${connection.id}.json`)
  await writeFile(file, JSON.stringify(connection), { mode: 0o600 })
  const update = (value: TerminalTray.State) => {
    const launch = value.enabled && !state.value.enabled
    state.value = value
    if (launch) void input.launch(file).catch((error) => input.log("Could not launch the menu-bar companion", error))
  }
  update({ enabled: input.enabled, focused: true, sessions: [] })
  return {
    connection,
    update,
    endpoint(endpoint: Endpoint) {
      state.endpoint = endpoint
    },
    subscribe(listener: (command: TerminalTray.Command) => void) {
      listeners.add(listener)
      pending.splice(0).forEach(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async close() {
      state.value = { enabled: false, focused: false, sessions: [] }
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(file, { force: true })
    },
  }
}

export async function launchTerminalTray(file: string, local: boolean, logDirectory: string) {
  const override = process.env.OPENCODE_TRAY_EXECUTABLE
  const script = fileURLToPath(new URL("../../../desktop/scripts/dev-terminal-tray.ts", import.meta.url))
  const executable =
    override ??
    (local
      ? process.execPath
      : join(dirname(process.execPath), "opencode-tray" + (process.platform === "win32" ? ".exe" : "")))
  await access(override || !local ? executable : script)
  await mkdir(logDirectory, { recursive: true })
  const log = await open(join(logDirectory, "terminal-tray.log"), "a", 0o600)
  const child = spawn(executable, override || !local ? [`--terminal-tray=${file}`] : [script, file], {
    cwd: local && !override ? dirname(dirname(script)) : undefined,
    env: process.env,
    stdio: ["ignore", log.fd, log.fd],
    detached: true,
    windowsHide: true,
  })
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve)
    child.once("error", reject)
  }).finally(() => log.close())
  child.unref()
}

export function focusTerminal() {
  if (process.platform !== "darwin") return
  const bundle = process.env.__CFBundleIdentifier
  if (!bundle || !/^[a-zA-Z0-9.-]+$/.test(bundle)) return
  execFile("osascript", ["-e", `tell application id "${bundle}" to activate`], () => {})
}
