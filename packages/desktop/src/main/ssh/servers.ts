import type {
  SshHostProbe,
  SshJob,
  SshServerConfig,
  SshServerItem,
  SshServerRuntime,
  SshServersEvent,
  SshServersState,
} from "../../preload/types"
import { SSH_SERVERS_KEY } from "../store-keys"
import { getStore } from "../store"
import { nativeT } from "../native-translations"
import { clearSshHostState, normalizeSshHost, sshServerIdForHost, sshServerIdToRestart } from "./policy"
import { sshServerIdsToStartOnInitialize } from "./startup"
import { installSshOpencode, openSshTerminal, probeSshHost, summarize } from "./runtime"
import { listSshConfigHosts } from "./ssh-config"

type RunningSidecar = {
  listener: { stop: () => void; onExit: (cb: (code: number | null, signal: NodeJS.Signals | null) => void) => void }
  url: string
  username: string | null
  password: string
}

type SpawnSidecar = (host: string) => Promise<RunningSidecar>

type ControllerLogger = {
  log: (message: string, meta?: unknown) => void
  error: (message: string, meta?: unknown) => void
}

type SshServersControllerOptions = {
  logger?: ControllerLogger
  readServers?: () => SshServerConfig[]
  writeServers?: (servers: SshServerConfig[]) => void
  probeHost?: typeof probeSshHost
  installOpencode?: typeof installSshOpencode
  openTerminal?: typeof openSshTerminal
  listConfigHosts?: () => string[]
}

export type SshServersController = ReturnType<typeof createSshServersController>

export function createSshServersController(
  appVersion: string,
  spawnSidecar: SpawnSidecar,
  options?: SshServersControllerOptions,
) {
  let state: SshServersState = initialState()
  const listeners = new Set<(event: SshServersEvent) => void>()
  const sidecars = new Map<string, RunningSidecar>()
  const startAttempts = new Map<string, number>()
  let jobAbort: AbortController | undefined
  const logger = options?.logger
  const readServers = options?.readServers ?? readPersistedServers
  const writeServers = options?.writeServers ?? writePersistedServers
  const probeHost = options?.probeHost ?? probeSshHost
  const listConfigHosts = options?.listConfigHosts ?? listSshConfigHosts

  const emit = () => {
    for (const listener of listeners) listener({ type: "state", state })
  }

  const setState = (next: Partial<SshServersState>) => {
    state = { ...state, ...next }
    emit()
  }

  const updateServer = (id: string, update: (item: SshServerItem) => SshServerItem) => {
    const next = state.servers.map((item) => (item.config.id === id ? update(item) : item))
    setState({ servers: next })
  }

  const beginJob = (job: SshJob): AbortController => {
    jobAbort?.abort()
    const abort = new AbortController()
    jobAbort = abort
    setState({ job })
    return abort
  }

  const endJob = (abort: AbortController) => {
    if (jobAbort !== abort) return
    jobAbort = undefined
    setState({ job: null })
  }

  const refreshFromStore = () => {
    const persisted = readServers().flatMap((value) => normalizePersistedServer(value))
    const items: SshServerItem[] = persisted.map((config) => {
      const existing = state.servers.find((item) => item.config.id === config.id)
      return {
        config,
        runtime: existing?.runtime ?? { kind: "stopped" },
      }
    })
    setState({ servers: items })
  }

  const setRuntime = (id: string, runtime: SshServerRuntime) => {
    updateServer(id, (item) => ({ ...item, runtime }))
  }

  const setHostProbe = (host: string, probe: SshHostProbe) => {
    setState({
      hostProbes: {
        ...state.hostProbes,
        [host]: probe,
      },
    })
  }

  const hasServer = (id: string) => state.servers.some((item) => item.config.id === id)

  const refreshHostProbeBackground = (host: string) => {
    void probeHost(host, appVersion)
      .then((probe) => setHostProbe(host, probe))
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        logger?.error("ssh host probe failed", { host, message })
      })
  }

  const nextStartAttempt = (id: string) => {
    const next = (startAttempts.get(id) ?? 0) + 1
    startAttempts.set(id, next)
    return next
  }

  const invalidateStartAttempt = (id: string) => {
    startAttempts.set(id, (startAttempts.get(id) ?? 0) + 1)
  }

  const isCurrentStartAttempt = (id: string, attempt: number) => {
    return startAttempts.get(id) === attempt && hasServer(id)
  }

  const startServer = async (id: string) => {
    const item = state.servers.find((x) => x.config.id === id)
    if (!item) return
    const attempt = nextStartAttempt(id)
    await stopServerInternal(id)
    if (!isCurrentStartAttempt(id, attempt)) return
    setRuntime(id, { kind: "starting" })
    logger?.log("ssh sidecar starting", { id, host: item.config.host })
    try {
      const sidecar = await spawnSidecar(item.config.host)
      if (!isCurrentStartAttempt(id, attempt)) {
        try {
          sidecar.listener.stop()
        } catch {
          // ignore stop errors for stale sidecars
        }
        return
      }
      sidecars.set(id, sidecar)
      setRuntime(id, {
        kind: "ready",
        url: sidecar.url,
        username: sidecar.username,
        password: sidecar.password,
      })
      sidecar.listener.onExit((code, signal) => {
        if (sidecars.get(id) !== sidecar) return
        sidecars.delete(id)
        const message = exitFailure(code, signal)
        setRuntime(id, { kind: "failed", message })
        logger?.error("ssh sidecar exited", { id, host: item.config.host, code, signal })
      })
      refreshHostProbeBackground(item.config.host)
      logger?.log("ssh sidecar ready", { id, host: item.config.host, url: sidecar.url })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!isCurrentStartAttempt(id, attempt)) return
      setRuntime(id, { kind: "failed", message, reason: failureReason(error) })
      logger?.error("ssh sidecar failed to start", { id, host: item.config.host, message })
    }
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

  const runJob = async <T>(job: SshJob, runner: (abort: AbortController) => Promise<T>) => {
    const abort = beginJob(job)
    try {
      const value = await runner(abort)
      endJob(abort)
      return value
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        endJob(abort)
        return undefined
      }
      const err = error instanceof Error ? error : new Error(String(error))
      endJob(abort)
      throw err
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
      refreshFromStore()
      void this.refreshConfigHosts().catch((error) => {
        logger?.error("ssh config hosts refresh failed", {
          message: error instanceof Error ? error.message : String(error),
        })
      })
      for (const id of sshServerIdsToStartOnInitialize(state.servers.map((item) => item.config))) void startServer(id)
    },

    async refreshConfigHosts() {
      setState({ configHosts: listConfigHosts() })
    },

    async probeHost(host: string) {
      const normalized = normalizeSshHost(host)
      if (!normalized) throw new Error(nativeT("desktop.ssh.error.invalidHost", { host }))
      await runJob({ kind: "probe-host", host: normalized, startedAt: Date.now() }, async (abort) => {
        setHostProbe(normalized, await probeHost(normalized, appVersion, { signal: abort.signal }))
      })
    },

    async installOpencode(host: string) {
      const normalized = normalizeSshHost(host)
      if (!normalized) throw new Error(nativeT("desktop.ssh.error.invalidHost", { host }))
      await runJob({ kind: "install-opencode", host: normalized, startedAt: Date.now() }, async (abort) => {
        const result = await (options?.installOpencode ?? installSshOpencode)(appVersion, normalized, {
          signal: abort.signal,
        })
        if (result.code !== 0) {
          throw new Error(summarize(result.stderr || result.stdout) || nativeT("desktop.ssh.error.installOpencode"))
        }
        setHostProbe(normalized, await probeHost(normalized, appVersion, { signal: abort.signal }))
        const id = sshServerIdToRestart(state.servers, normalized)
        if (id) await startServer(id)
      })
    },

    async openTerminal(host: string) {
      await (options?.openTerminal ?? openSshTerminal)(host)
    },

    async addServer(host: string): Promise<SshServerConfig> {
      const normalized = normalizeSshHost(host)
      if (!normalized) throw new Error(nativeT("desktop.ssh.error.invalidHost", { host }))
      const id = sshServerIdForHost(normalized)
      if (state.servers.some((item) => item.config.id === id)) {
        throw new Error(nativeT("desktop.ssh.error.alreadyAdded", { host: normalized }))
      }
      const config: SshServerConfig = {
        id,
        host: normalized,
      }
      writeServers([...readServers(), config])
      setState({
        servers: [...state.servers, { config, runtime: { kind: "starting" } }],
      })
      void startServer(id)
      return config
    },

    async removeServer(id: string) {
      const host = state.servers.find((item) => item.config.id === id)?.config.host
      invalidateStartAttempt(id)
      await stopServerInternal(id)
      const remaining = readServers().filter((item) => item.id !== id)
      writeServers(remaining)
      setState({
        servers: state.servers.filter((item) => item.config.id !== id),
        ...(host ? clearSshHostState(state.hostProbes, host) : {}),
      })
    },

    startServer,

    async stopServer(id: string) {
      if (!hasServer(id)) return
      invalidateStartAttempt(id)
      await stopServerInternal(id)
      setRuntime(id, { kind: "stopped" })
    },

    stopAll() {
      for (const item of state.servers) invalidateStartAttempt(item.config.id)
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

function initialState(): SshServersState {
  return {
    configHosts: [],
    hostProbes: {},
    servers: [],
    job: null,
  }
}

function failureReason(error: unknown) {
  if (error instanceof Error && (error as { reason?: string }).reason === "opencode-missing") {
    return "opencode-missing" as const
  }
  return undefined
}

function readPersistedServers(): SshServerConfig[] {
  const store = getStore()
  const existing = store.get(SSH_SERVERS_KEY)
  if (existing && typeof existing === "object") {
    const record = existing as { servers?: unknown }
    const list = Array.isArray(record.servers) ? record.servers : []
    return list.flatMap(normalizePersistedServer)
  }
  return []
}

function writePersistedServers(servers: SshServerConfig[]) {
  getStore().set(SSH_SERVERS_KEY, { servers })
}

function normalizePersistedServer(value: unknown): SshServerConfig[] {
  if (!value || typeof value !== "object") return []
  const record = value as Record<string, unknown>
  const host = typeof record.host === "string" ? normalizeSshHost(record.host) : null
  if (!host) return []
  const id = typeof record.id === "string" && record.id.length > 0 ? record.id : sshServerIdForHost(host)
  return [
    {
      id,
      host,
    },
  ]
}

function exitFailure(code: number | null, signal: NodeJS.Signals | null) {
  return nativeT("desktop.ssh.error.serverExited", { code: code ?? "null", signal: signal ?? "null" })
}

// Re-export types used by callers
export type { SshHostProbe, SshJob, SshServerConfig, SshServerItem, SshServerRuntime, SshServersEvent, SshServersState }
