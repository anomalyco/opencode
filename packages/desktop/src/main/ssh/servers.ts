import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { createServer } from "node:net"
import type {
  SshConnectionConfig,
  SshServerItem,
  SshServerRuntime,
  SshServersEvent,
  SshServersState,
} from "../../preload/types"
import { SSH_SERVERS_KEY } from "../store-keys"
import { getStore } from "../store"
import { checkHealth } from "../server"
import { nativeT } from "../native-translations"

type RunningSidecar = {
  listener: { stop: () => void; onExit: (cb: (code: number | null, signal: NodeJS.Signals | null) => void) => void }
  url: string
  username: string | null
  password: string
}

export type SshServersController = ReturnType<typeof createSshServersController>

export function createSshServersController() {
  let state: SshServersState = { servers: [] }
  const listeners = new Set<(event: SshServersEvent) => void>()
  const sidecars = new Map<string, RunningSidecar>()
  const startAttempts = new Map<string, number>()

  const emit = () => {
    for (const listener of listeners) listener({ type: "state", state })
  }

  const setState = (next: Partial<SshServersState>) => {
    state = { ...state, ...next }
    emit()
  }

  const readPersistedServers = (): SshConnectionConfig[] => {
    const store = getStore()
    const existing = store.get(SSH_SERVERS_KEY)
    if (existing && typeof existing === "object") {
      const record = existing as { servers?: unknown }
      const list = Array.isArray(record.servers) ? record.servers : []
      return list.flatMap(normalizePersistedServer)
    }
    return []
  }

  const writePersistedServers = (servers: SshConnectionConfig[]) => {
    getStore().set(SSH_SERVERS_KEY, { servers })
  }

  const updateServer = (id: string, update: (item: SshServerItem) => SshServerItem) => {
    const next = state.servers.map((item) => (item.config.id === id ? update(item) : item))
    setState({ servers: next })
  }

  const setRuntime = (id: string, runtime: SshServerRuntime) => {
    updateServer(id, (item) => ({ ...item, runtime }))
  }

  const nextStartAttempt = (id: string) => {
    const next = (startAttempts.get(id) ?? 0) + 1
    startAttempts.set(id, next)
    return next
  }

  const isCurrentStartAttempt = (id: string, attempt: number) => {
    return startAttempts.get(id) === attempt && state.servers.some((item) => item.config.id === id)
  }

  const stopServerInternal = async (id: string) => {
    const existing = sidecars.get(id)
    if (!existing) return
    sidecars.delete(id)
    try {
      existing.listener.stop()
    } catch {
      // ignore stop errors
    }
  }

  return {
    getState() {
      return state
    },
    subscribe(listener: (event: SshServersEvent) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    async initialize() {
      const persisted = readPersistedServers()
      const items: SshServerItem[] = persisted.map((config) => ({
        config,
        runtime: { kind: "stopped" },
      }))
      setState({ servers: items })
    },

    async addServer(config: SshConnectionConfig): Promise<SshServerItem> {
      const id = `ssh:${randomUUID()}`
      const fullConfig = { ...config, id }
      const persisted = readPersistedServers()
      writePersistedServers([...persisted, fullConfig])
      const item: SshServerItem = { config: fullConfig, runtime: { kind: "stopped" } }
      setState({ servers: [...state.servers, item] })
      return item
    },

    async removeServer(id: string) {
      startAttempts.delete(id)
      await stopServerInternal(id)
      const persisted = readPersistedServers().filter((item) => item.id !== id)
      writePersistedServers(persisted)
      setState({ servers: state.servers.filter((item) => item.config.id !== id) })
    },

    async startServer(id: string) {
      const item = state.servers.find((x) => x.config.id === id)
      if (!item) return
      const attempt = nextStartAttempt(id)
      await stopServerInternal(id)
      if (!isCurrentStartAttempt(id, attempt)) return
      setRuntime(id, { kind: "authenticating" })
      try {
        if (!isCurrentStartAttempt(id, attempt)) return
        await ensureOpencodeInstalled(item.config, (runtime) => setRuntime(id, runtime))
        if (!isCurrentStartAttempt(id, attempt)) return

        setRuntime(id, { kind: "starting" })
        const port = await allocatePort()
        const password = randomUUID()
        const username = "opencode"

        const sshArgs = buildSshArgs(item.config, port, password, username)
        const child = spawn("ssh", sshArgs, {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        })

        const recentOutput: string[] = []
        forwardLines(child.stdout!, "stdout", (text) => {
          if (text.trim()) recentOutput.push(text)
        })
        forwardLines(child.stderr!, "stderr", (text) => {
          if (text.trim()) recentOutput.push(text)
        })

        const sidecar: RunningSidecar = {
          listener: { stop: () => child.kill(), onExit: (cb) => child.once("exit", cb) },
          url: `http://127.0.0.1:${port}`,
          username,
          password,
        }

        let settled = false
        child.once("exit", (code, signal) => {
          settled = true
          if (sidecars.get(id) !== sidecar) return
          sidecars.delete(id)
          const output = recentOutput.length ? "\n" + recentOutput.slice(-20).join("\n") : ""
          const message = nativeT("desktop.ssh.error.serverExited", {
            code: code ?? "null",
            signal: signal ?? "null",
          }) + output
          setRuntime(id, { kind: "failed", message })
        })

        const healthTimeoutMs = 120_000

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            child.kill()
            const output = recentOutput.length ? "\n" + recentOutput.slice(-20).join("\n") : ""
            reject(new Error(nativeT("desktop.ssh.error.healthTimeout", { host: item.config.host, timeout: healthTimeoutMs }) + output))
          }, healthTimeoutMs)

          const poll = () => {
            if (settled) return
            checkHealth(sidecar.url, password).then((healthy) => {
              if (settled) return
              clearTimeout(timeout)
              if (healthy) {
                if (!isCurrentStartAttempt(id, attempt)) {
                  child.kill()
                  reject(new Error("stale"))
                  return
                }
                sidecars.set(id, sidecar)
                setRuntime(id, { kind: "ready", url: sidecar.url, username, password })
                resolve()
              } else {
                setTimeout(poll, 500)
              }
            }).catch(() => {
              if (!settled) setTimeout(poll, 500)
            })
          }
          setTimeout(poll, 1000)
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message === "stale") return
        if (!isCurrentStartAttempt(id, attempt)) return
        setRuntime(id, { kind: "failed", message })
      }
    },

    stopAll() {
      for (const item of state.servers) startAttempts.delete(item.config.id)
      for (const existing of sidecars.values()) {
        try {
          existing.listener.stop()
        } catch {
          // ignore
        }
      }
      sidecars.clear()
    },
  }
}

function buildSshArgs(config: SshConnectionConfig, port: number, password: string, username: string): string[] {
  const args: string[] = ["-o", "StrictHostKeyChecking=accept-new", "-L", `${port}:127.0.0.1:${port}`]
  if (config.port) args.push("-p", String(config.port))
  if (config.identityFile) args.push("-i", config.identityFile)
  args.push(config.host)
  args.push(
    `OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER=true OPENCODE_CLIENT=desktop OPENCODE_SERVER_USERNAME=${username} OPENCODE_SERVER_PASSWORD=${password} $HOME/.opencode/bin/opencode serve --hostname 127.0.0.1 --port ${port}`,
  )
  return args
}

async function ensureOpencodeInstalled(config: SshConnectionConfig, setRuntime: (r: SshServerRuntime) => void) {
  const check = await runSshCommand(config, 'test -x "$HOME/.opencode/bin/opencode" && echo found', 10_000)
  if (check.stdout.trim() === "found") return

  setRuntime({ kind: "installing" })

  const result = await runSshCommand(
    config,
    "curl -fsSL https://opencode.ai/install | bash",
    300_000,
  )

  const verify = await runSshCommand(config, 'test -x "$HOME/.opencode/bin/opencode" && echo found', 5_000)
  if (verify.stdout.trim() !== "found") {
    const detail = (result.stderr + "\n" + result.stdout).trim().slice(-500) || "no output"
    throw new Error(`OpenCode install failed. Output:\n${detail}`)
  }
}

function runSshCommand(config: SshConnectionConfig, command: string, timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const args: string[] = ["-o", "StrictHostKeyChecking=accept-new", `-o`, `ConnectTimeout=${Math.floor(timeoutMs / 1000)}`]
    if (config.port) args.push("-p", String(config.port))
    if (config.identityFile) args.push("-i", config.identityFile)
    args.push(config.host, command)
    const child = spawn("ssh", args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    let stdout = ""
    let stderr = ""
    child.stdout!.on("data", (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr!.on("data", (chunk: Buffer) => { stderr += chunk.toString() })
    child.on("error", reject)
    const timer = setTimeout(() => { child.kill(); reject(new Error(`SSH command timed out after ${timeoutMs}ms`)) }, timeoutMs)
    child.on("exit", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }) })
  })
}

function allocatePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (typeof address !== "object" || !address) {
        server.close()
        reject(new Error(nativeT("desktop.wsl.error.failedPort")))
        return
      }
      server.close(() => resolve(address.port))
    })
  })
}

function forwardLines(stream: NodeJS.ReadableStream, source: string, onLine: (text: string) => void) {
  let pending = ""
  stream.setEncoding("utf8")
  stream.on("data", (chunk: string) => {
    pending += chunk
    const lines = pending.split(/\r?\n/g)
    pending = lines.pop() ?? ""
    lines.forEach((text) => onLine(text))
  })
  stream.on("end", () => {
    if (pending) onLine(pending)
  })
}

function normalizePersistedServer(value: unknown): SshConnectionConfig[] {
  if (!value || typeof value !== "object") return []
  const record = value as Record<string, unknown>
  const name = typeof record.name === "string" && record.name.length > 0 ? record.name : null
  const host = typeof record.host === "string" && record.host.length > 0 ? record.host : null
  if (!name || !host) return []
  return [
    {
      id: typeof record.id === "string" && record.id.length > 0 ? record.id : `ssh:${name}`,
      name,
      host,
      port: typeof record.port === "number" && record.port > 0 ? record.port : undefined,
      identityFile: typeof record.identityFile === "string" && record.identityFile.length > 0 ? record.identityFile : undefined,
    },
  ]
}

export type { SshConnectionConfig, SshServerItem, SshServerRuntime, SshServersEvent, SshServersState }
