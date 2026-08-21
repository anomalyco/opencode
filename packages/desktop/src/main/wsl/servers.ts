import type {
  WslDistroProbe,
  WslJob,
  WslOpencodeCheck,
  WslServerConfig,
  WslServerItem,
  WslServerRuntime,
  WslServersEvent,
  WslServersState,
} from "@opencode-ai/app/wsl/types"
import { Effect } from "effect"
import { nativeT } from "../native/translations"
import { WSL_SERVERS_KEY } from "../storage/keys"
import { getStore } from "../storage/store"
import {
  installWslRuntimeElevated,
  listInstalledWslDistros,
  listOnlineWslDistros,
  openWslTerminal,
  probeWslDistro,
  probeWslRuntime,
  readWslCliVersion,
  resolveWslCli,
  type WslCliBuild,
} from "./runtime"

type RunningSidecar = {
  stop: () => Promise<void>
  onExit: (cb: (code: number | null, signal: NodeJS.Signals | null) => void) => void
  url: string
  username: string | null
  password: string
}

type SpawnSidecar = (distro: string) => Promise<RunningSidecar>

type WslServersControllerOptions = {
  cli: WslCliBuild
  spawnSidecar: SpawnSidecar
  installCli: (distro: string, cli: WslCliBuild) => Promise<void>
  installDistro: (distro: string) => Promise<void>
  readServers?: () => WslServerConfig[]
  writeServers?: (servers: WslServerConfig[]) => void
  probeDistro?: typeof probeWslDistro
  resolveCli?: typeof resolveWslCli
  readCliVersion?: typeof readWslCliVersion
}

export type WslServersController = Effect.Success<ReturnType<typeof createWslServersController>>

export function wslServerIdForDistro(distro: string) {
  return `wsl:${distro}`
}

export const createWslServersController = Effect.fn("WslServers.make")(function* (
  options: WslServersControllerOptions,
) {
  const runFork = Effect.runForkWith(yield* Effect.context())
  let state: WslServersState = initialState()
  const listeners = new Set<(event: WslServersEvent) => void>()
  const sidecars = new Map<string, RunningSidecar>()
  const starts = new Map<string, symbol>()
  let closed = false
  const readServers = options.readServers ?? readPersistedServers
  const writeServers = options.writeServers ?? writePersistedServers
  const probeDistro = options.probeDistro ?? probeWslDistro

  const emit = () => {
    for (const listener of listeners) listener({ type: "state", state })
  }

  const setState = (next: Partial<WslServersState>) => {
    state = { ...state, ...next }
    emit()
  }

  const updateServer = (id: string, update: (item: WslServerItem) => WslServerItem) => {
    const next = state.servers.map((item) => (item.config.id === id ? update(item) : item))
    setState({ servers: next })
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

  const setCliCheck = (distro: string, check: WslOpencodeCheck) => {
    setState({
      opencodeChecks: {
        ...state.opencodeChecks,
        [distro]: check,
      },
    })
  }

  const inspectCli = async (distro: string) => {
    const resolved = await (options.resolveCli ?? resolveWslCli)(distro)
    const version = resolved ? await (options.readCliVersion ?? readWslCliVersion)(resolved, distro) : null
    return cliCheck(distro, resolved, version, options.cli.version)
  }

  const refreshCliCheck = async (distro: string) => {
    const check = await inspectCli(distro)
    setCliCheck(distro, check)
    return check
  }

  const probeAddableDistros = async (distros: string[]) => {
    const unique = [...new Set(distros)]
    const distroProbes = await Promise.all(
      unique
        .filter((distro) => !state.distroProbes[distro])
        .map(async (distro) => [distro, await probeDistro(distro)] as const),
    )
    if (distroProbes.length) {
      setState({ distroProbes: { ...state.distroProbes, ...Object.fromEntries(distroProbes) } })
    }

    const opencodeChecks = await Promise.all(
      unique
        .filter((distro) => distroProbeReady(state.distroProbes[distro]))
        .filter((distro) => !state.opencodeChecks[distro])
        .map(async (distro) => [distro, await inspectCli(distro)] as const),
    )
    if (opencodeChecks.length) {
      setState({ opencodeChecks: { ...state.opencodeChecks, ...Object.fromEntries(opencodeChecks) } })
    }
  }

  const refreshCliCheckSafely = (id: string, distro: string) => {
    return refreshCliCheck(distro).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      runFork(Effect.logError("wsl CLI check failed", { id, distro, message }))
    })
  }

  const refreshCliChecks = async () => {
    await Promise.all(state.servers.map((item) => refreshCliCheckSafely(item.config.id, item.config.distro)))
  }

  const refreshDistroLists = async () => {
    const [installed, online] = await Promise.all([listInstalledWslDistros(), listOnlineWslDistros()])
    return { installed, online }
  }

  const startServer = async (id: string) => {
    const item = state.servers.find((x) => x.config.id === id)
    if (!item) return
    await stopServer(id)
    if (closed) return
    const token = Symbol()
    starts.set(id, token)
    setRuntime(id, { kind: "starting" })
    runFork(Effect.logInfo("wsl sidecar starting", { id, distro: item.config.distro }))
    try {
      const sidecar = await options.spawnSidecar(item.config.distro)
      if (starts.get(id) !== token) {
        await sidecar.stop()
        return
      }
      starts.delete(id)
      sidecars.set(id, sidecar)
      setRuntime(id, {
        kind: "ready",
        url: sidecar.url,
        username: sidecar.username,
        password: sidecar.password,
      })
      sidecar.onExit((code, signal) => {
        if (sidecars.get(id) !== sidecar) return
        sidecars.delete(id)
        const message = startupFailure(code, signal)
        setRuntime(id, { kind: "failed", message })
        runFork(Effect.logError("wsl sidecar exited", { id, distro: item.config.distro, code, signal }))
      })
      void refreshCliCheckSafely(id, item.config.distro)
      runFork(Effect.logInfo("wsl sidecar ready", { id, distro: item.config.distro, url: sidecar.url }))
    } catch (error) {
      if (starts.get(id) !== token) return
      starts.delete(id)
      const message = error instanceof Error ? error.message : String(error)
      setRuntime(id, { kind: "failed", message })
      runFork(Effect.logError("wsl sidecar failed to start", { id, distro: item.config.distro, message }))
    }
  }

  const stopServer = async (id: string) => {
    starts.delete(id)
    const existing = sidecars.get(id)
    if (!existing) return
    sidecars.delete(id)
    await existing.stop()
    setRuntime(id, { kind: "stopped" })
  }

  const runJob = async <T>(job: WslJob, runner: () => Promise<T>) => {
    setState({ job })
    try {
      return await runner()
    } finally {
      setState({ job: null })
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

    startConfiguredServers() {
      closed = false
      refreshFromStore()
      void refreshCliChecks()
      state.servers.forEach((item) => void startServer(item.config.id))
    },

    async probeRuntime() {
      await runJob({ kind: "runtime", startedAt: Date.now() }, async () => {
        const runtime = await probeWslRuntime()
        setState({
          runtime,
          pendingRestart: state.pendingRestart && !runtime.available ? state.pendingRestart : false,
        })
      })
    },

    async refreshDistros() {
      await runJob({ kind: "distros", startedAt: Date.now() }, async () => {
        setState(await refreshDistroLists())
      })
    },

    async installWsl() {
      await runJob({ kind: "install-wsl", startedAt: Date.now() }, async () => {
        await installWslRuntimeElevated()
        const runtime = await probeWslRuntime()
        setState({ runtime, pendingRestart: !runtime.available })
      })
    },

    async installDistro(distro: string) {
      await runJob({ kind: "install-distro", distro, startedAt: Date.now() }, async () => {
        await options.installDistro(distro)
        const distros = await refreshDistroLists()
        const probe = await probeDistro(distro)
        setState({
          ...distros,
          distroProbes: { ...state.distroProbes, [distro]: probe },
        })
      })
    },

    async probeAddable(distros: string[]) {
      if (!distros.length) return
      await runJob({ kind: "probe-addable", distros, startedAt: Date.now() }, () => probeAddableDistros(distros))
    },

    async installOpencode(distro: string) {
      await runJob({ kind: "install-opencode", distro, startedAt: Date.now() }, async () => {
        const id = state.servers.find((item) => item.config.distro === distro)?.config.id
        if (id) await stopServer(id)
        await options.installCli(distro, options.cli)
        requireMatchingCli(await refreshCliCheck(distro), options.cli.version)
        if (id) await startServer(id)
      })
    },

    async openTerminal(distro: string) {
      await openWslTerminal(distro)
    },

    async addServer(distro: string): Promise<WslServerConfig> {
      const id = wslServerIdForDistro(distro)
      if (state.servers.some((item) => item.config.id === id)) {
        throw new Error(nativeT("desktop.wsl.error.alreadyAdded", { distro }))
      }
      const config: WslServerConfig = {
        id,
        distro,
      }
      writeServers([...readServers(), config])
      setState({
        servers: [...state.servers, { config, runtime: { kind: "starting" } }],
      })
      void startServer(id)
      return config
    },

    async removeServer(id: string) {
      const distro = state.servers.find((item) => item.config.id === id)?.config.distro
      await stopServer(id)
      const remaining = readServers().filter((item) => item.id !== id)
      writeServers(remaining)
      setState({
        servers: state.servers.filter((item) => item.config.id !== id),
        ...(distro ? removeDistroState(state, distro) : {}),
      })
    },

    startServer,

    async stopServers() {
      closed = true
      starts.clear()
      await Promise.all([...sidecars.values()].map((sidecar) => sidecar.stop()))
      sidecars.clear()
    },
  }
})

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

function cliCheck(
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
      error: nativeT("desktop.wsl.error.opencodeMissing"),
    }
  }
  if (!version) {
    return {
      distro,
      resolvedPath,
      version: null,
      expectedVersion,
      matchesDesktop: null,
      error: nativeT("desktop.wsl.error.opencodeCannotRun"),
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

function requireMatchingCli(check: WslOpencodeCheck, expected: string) {
  if (check.version === expected) return
  throw new Error(
    nativeT("desktop.wsl.error.updateVersion", {
      distro: check.distro,
      installed: check.version ?? nativeT("desktop.wsl.error.noVersion"),
      expected,
    }),
  )
}

function removeDistroState(state: WslServersState, distro: string) {
  const distroProbes = { ...state.distroProbes }
  const opencodeChecks = { ...state.opencodeChecks }
  delete distroProbes[distro]
  delete opencodeChecks[distro]
  return { distroProbes, opencodeChecks }
}

function distroProbeReady(probe: WslDistroProbe | undefined) {
  return !!probe?.canExecute && probe.hasBash && probe.hasCurl
}

function startupFailure(code: number | null, signal: NodeJS.Signals | null) {
  return nativeT("desktop.wsl.error.serverExited", { code: code ?? "null", signal: signal ?? "null" })
}
