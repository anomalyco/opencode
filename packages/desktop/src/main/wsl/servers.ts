import type {
  WslDistroProbe,
  WslInstalledDistro,
  WslJob,
  WslOnlineDistro,
  WslOpencodeCheck,
  WslRuntimeCheck,
  WslServerConfig,
  WslServerItem,
  WslServerRuntime,
  WslServersEvent,
  WslServersState,
} from "../../preload/types"
import { WSL_SERVERS_KEY } from "../store-keys"
import { getStore } from "../store"
import { expectOpencodeVersion, pendingRestartAfterWslInstall, wslServerIdsToStartOnInitialize } from "./startup"
import { clearWslDistroState, wslServerIdToRestart } from "./policy"
import {
  installWslDistro,
  installWslOpencode,
  installWslRuntimeElevated,
  listInstalledWslDistros,
  listOnlineWslDistros,
  openWslTerminal,
  probeWslDistro,
  probeWslRuntime,
  readWslCommandVersion,
  resolveWslOpencode,
  summarize,
} from "./runtime"

type RunningSidecar = {
  listener: { stop: () => void; onExit: (cb: (code: number | null, signal: NodeJS.Signals | null) => void) => void }
  url: string
  username: string | null
  password: string
}

type SpawnSidecar = (distro: string) => Promise<RunningSidecar>

type ControllerLogger = {
  log: (message: string, meta?: unknown) => void
  error: (message: string, meta?: unknown) => void
}

type WslServersControllerOptions = {
  logger?: ControllerLogger
  readServers?: () => WslServerConfig[]
  writeServers?: (servers: WslServerConfig[]) => void
  resolveOpencode?: typeof resolveWslOpencode
  readCommandVersion?: typeof readWslCommandVersion
}

export type WslServersController = ReturnType<typeof createWslServersController>

export function wslServerIdForDistro(distro: string) {
  return `wsl:${distro}`
}

export function createWslServersController(
  appVersion: string,
  spawnSidecar: SpawnSidecar,
  options?: WslServersControllerOptions,
) {
  let state: WslServersState = initialState()
  const listeners = new Set<(event: WslServersEvent) => void>()
  const sidecars = new Map<string, RunningSidecar>()
  const startAttempts = new Map<string, number>()
  let jobAbort: AbortController | undefined
  const logger = options?.logger
  const readServers = options?.readServers ?? readPersistedServers
  const writeServers = options?.writeServers ?? writePersistedServers

  const emit = () => {
    for (const listener of listeners) listener({ type: "state", state })
  }

  const setState = (next: Partial<WslServersState>) => {
    state = { ...state, ...next }
    emit()
  }

  const persistServers = (servers: WslServerConfig[]) => {
    writeServers(servers)
  }

  const updateServer = (id: string, update: (item: WslServerItem) => WslServerItem) => {
    const next = state.servers.map((item) => (item.config.id === id ? update(item) : item))
    setState({ servers: next })
  }

  const beginJob = (job: WslJob): AbortController => {
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
    const persisted = readServers()
    const items: WslServerItem[] = persisted.map((config) => {
      const existing = state.servers.find((item) => item.config.id === config.id)
      return {
        config,
        runtime: existing?.runtime ?? { kind: "stopped" },
      }
    })
    setState({ servers: items })
  }

  const setRuntime = (id: string, runtime: WslServerRuntime) => {
    updateServer(id, (item) => ({ ...item, runtime }))
  }

  const setOpencodeCheck = (distro: string, check: WslOpencodeCheck) => {
    setState({
      opencodeChecks: {
        ...state.opencodeChecks,
        [distro]: check,
      },
    })
  }

  const checkOpencode = async (distro: string, opts?: { signal?: AbortSignal }) => {
    const resolved = await (options?.resolveOpencode ?? resolveWslOpencode)(distro, opts)
    const version = resolved
      ? await (options?.readCommandVersion ?? readWslCommandVersion)(resolved, distro, opts)
      : null
    return opencodeCheck(distro, resolved, version, appVersion)
  }

  const refreshOpencodeCheck = async (distro: string, opts?: { signal?: AbortSignal }) => {
    setOpencodeCheck(distro, await checkOpencode(distro, opts))
  }

  const hasServer = (id: string, distro: string) => {
    return state.servers.some((item) => item.config.id === id && item.config.distro === distro)
  }

  const refreshOpencodeCheckBackground = (id: string, distro: string) => {
    void checkOpencode(distro)
      .then((check) => {
        if (!hasServer(id, distro)) return
        setOpencodeCheck(distro, check)
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        logger?.error("wsl opencode check failed", { id, distro, message })
      })
  }

  const refreshOpencodeChecks = async () => {
    await Promise.all(
      state.servers.map((item) =>
        checkOpencode(item.config.distro)
          .then((check) => {
            if (!hasServer(item.config.id, item.config.distro)) return
            setOpencodeCheck(item.config.distro, check)
          })
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error)
            logger?.error("wsl opencode check failed", {
              id: item.config.id,
              distro: item.config.distro,
              message,
            })
          }),
      ),
    )
  }

  const refreshDistroLists = async (opts: { signal?: AbortSignal }) => {
    const [installed, online] = await Promise.all([listInstalledWslDistros(opts), listOnlineWslDistros(opts)])
    return { installed, online }
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
    return startAttempts.get(id) === attempt && state.servers.some((item) => item.config.id === id)
  }

  const startServer = async (id: string) => {
    const item = state.servers.find((x) => x.config.id === id)
    if (!item) return
    const attempt = nextStartAttempt(id)
    await stopServerInternal(id)
    if (!isCurrentStartAttempt(id, attempt)) return
    setRuntime(id, { kind: "starting" })
    logger?.log("wsl sidecar starting", { id, distro: item.config.distro })
    try {
      const sidecar = await spawnSidecar(item.config.distro)
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
        const message = startupFailure(code, signal)
        setRuntime(id, { kind: "failed", message })
        logger?.error("wsl sidecar exited", { id, distro: item.config.distro, code, signal })
      })
      refreshOpencodeCheckBackground(id, item.config.distro)
      logger?.log("wsl sidecar ready", { id, distro: item.config.distro, url: sidecar.url })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!isCurrentStartAttempt(id, attempt)) return
      setRuntime(id, { kind: "failed", message })
      // Without this, an Ubuntu-style silent failure leaves no trace in
      // main.log — the controller captures the message in its state but
      // nothing surfaces unless the user opens the WSL servers dialog.
      logger?.error("wsl sidecar failed to start", { id, distro: item.config.distro, message })
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

  const runJob = async <T>(job: WslJob, runner: (abort: AbortController) => Promise<T>) => {
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
    subscribe(listener: (event: WslServersEvent) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    async initialize() {
      refreshFromStore()
      void refreshOpencodeChecks()
      for (const id of wslServerIdsToStartOnInitialize(state.servers.map((item) => item.config))) void startServer(id)
    },

    async probeRuntime() {
      await runJob({ kind: "runtime", startedAt: Date.now() }, async (abort) => {
        const runtime = await probeWslRuntime({ signal: abort.signal })
        setState({
          runtime,
          pendingRestart: state.pendingRestart && !runtime.available ? state.pendingRestart : false,
        })
      })
    },

    async refreshDistros() {
      await runJob({ kind: "distros", startedAt: Date.now() }, async (abort) => {
        setState(await refreshDistroLists({ signal: abort.signal }))
      })
    },

    async installWsl() {
      await runJob({ kind: "install-wsl", startedAt: Date.now() }, async (abort) => {
        const result = await installWslRuntimeElevated({ signal: abort.signal })
        if (result.code !== 0) {
          const message = summarize(result.stderr || result.stdout) || "WSL installation failed"
          throw new Error(message)
        }
        const runtime = await probeWslRuntime({ signal: abort.signal })
        setState({ runtime, pendingRestart: pendingRestartAfterWslInstall(runtime) })
      })
    },

    async installDistro(name: string) {
      await runJob({ kind: "install-distro", distro: name, startedAt: Date.now() }, async (abort) => {
        const result = await installWslDistro(name, { signal: abort.signal })
        if (result.code !== 0) {
          const message = summarize(result.stderr || result.stdout) || `Failed to install distro: ${name}`
          throw new Error(message)
        }
        const distros = await refreshDistroLists({ signal: abort.signal })
        const probe = await probeWslDistro(name, { signal: abort.signal })
        setState({
          ...distros,
          distroProbes: { ...state.distroProbes, [name]: probe },
        })
      })
    },

    async probeDistro(name: string) {
      await runJob({ kind: "probe-distro", distro: name, startedAt: Date.now() }, async (abort) => {
        const probe = await probeWslDistro(name, { signal: abort.signal })
        setState({ distroProbes: { ...state.distroProbes, [name]: probe } })
      })
    },

    async probeOpencode(name: string) {
      await runJob({ kind: "probe-opencode", distro: name, startedAt: Date.now() }, async (abort) => {
        await refreshOpencodeCheck(name, { signal: abort.signal })
      })
    },

    async installOpencode(name: string) {
      await runJob({ kind: "install-opencode", distro: name, startedAt: Date.now() }, async (abort) => {
        const result = await installWslOpencode(appVersion, name, { signal: abort.signal })
        if (result.code !== 0) {
          throw new Error(summarize(result.stderr || result.stdout) || "OpenCode installation failed")
        }
        await refreshOpencodeCheck(name, { signal: abort.signal })
        expectOpencodeVersion(state.opencodeChecks[name]?.version ?? null, appVersion, name)
        const id = wslServerIdToRestart(state.servers, name)
        if (id) await startServer(id)
      })
    },

    async openTerminal(name: string) {
      await openWslTerminal(name)
    },

    async addServer(distro: string): Promise<WslServerConfig> {
      const id = wslServerIdForDistro(distro)
      if (state.servers.some((item) => item.config.id === id)) {
        throw new Error(`${distro} is already added`)
      }
      const config: WslServerConfig = {
        id,
        distro,
      }
      persistServers([...readServers(), config])
      setState({
        servers: [...state.servers, { config, runtime: { kind: "starting" } }],
      })
      void startServer(id)
      return config
    },

    async removeServer(id: string) {
      const distro = state.servers.find((item) => item.config.id === id)?.config.distro
      invalidateStartAttempt(id)
      await stopServerInternal(id)
      const remaining = readServers().filter((item) => item.id !== id)
      persistServers(remaining)
      setState({
        servers: state.servers.filter((item) => item.config.id !== id),
        ...(distro ? clearWslDistroState(state.distroProbes, state.opencodeChecks, distro) : {}),
      })
    },

    startServer,

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

function initialState(): WslServersState {
  return {
    runtime: null,
    installed: [],
    online: [],
    distroProbes: {},
    opencodeChecks: {},
    pendingRestart: false,
    servers: [],
    job: null,
  }
}

function readPersistedServers(): WslServerConfig[] {
  const store = getStore()
  const existing = store.get(WSL_SERVERS_KEY)
  if (existing && typeof existing === "object") {
    const record = existing as { servers?: unknown }
    const list = Array.isArray(record.servers) ? record.servers : []
    return list.flatMap(normalizePersistedServer)
  }
  return []
}

function writePersistedServers(servers: WslServerConfig[]) {
  getStore().set(WSL_SERVERS_KEY, { servers })
}

function normalizePersistedServer(value: unknown): WslServerConfig[] {
  if (!value || typeof value !== "object") return []
  const record = value as Record<string, unknown>
  const distro = typeof record.distro === "string" && record.distro.length > 0 ? record.distro : null
  if (!distro) return []
  const id = typeof record.id === "string" && record.id.length > 0 ? record.id : wslServerIdForDistro(distro)
  return [
    {
      id,
      distro,
    },
  ]
}

function opencodeCheck(
  distro: string,
  resolvedPath: string | null,
  version: string | null,
  expectedVersion: string,
): WslOpencodeCheck {
  if (!resolvedPath) {
    return {
      distro,
      resolvedPath: null,
      version: null,
      expectedVersion,
      matchesDesktop: null,
      error: "opencode is not installed in this distro",
    }
  }
  if (!version) {
    return {
      distro,
      resolvedPath,
      version: null,
      expectedVersion,
      matchesDesktop: null,
      error: "opencode is installed but could not run",
    }
  }
  return {
    distro,
    resolvedPath,
    version,
    expectedVersion,
    matchesDesktop: version === expectedVersion,
    error: null,
  }
}

function startupFailure(code: number | null, signal: NodeJS.Signals | null) {
  return `WSL server exited after startup (code=${code ?? "null"} signal=${signal ?? "null"})`
}

// Re-export types used by callers
export type {
  WslInstalledDistro,
  WslOnlineDistro,
  WslRuntimeCheck,
  WslDistroProbe,
  WslOpencodeCheck,
  WslServerConfig,
  WslServerItem,
  WslServerRuntime,
  WslServersEvent,
  WslServersState,
}
