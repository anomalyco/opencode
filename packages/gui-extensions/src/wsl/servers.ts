import type { MainContext } from "../sdk/main"
import type {
  WslDistroProbe,
  WslJob,
  WslOpencodeCheck,
  WslServerConfig,
  WslServerItem,
  WslServerRuntime,
  WslServersState,
} from "./contract"
import type { WslCliBuild, WslRuntime } from "./runtime"

type RunningSidecar = {
  stop: () => Promise<void>
  onExit: (cb: (code: number | null, signal: NodeJS.Signals | null) => void) => void
  url: string
  password: string
}

type WslServersControllerOptions = {
  cli: WslCliBuild
  runtime: WslRuntime
  t: MainContext["t"]
  log: <Data extends Readonly<Record<string, unknown>>>(level: "info" | "error", message: string, data: Data) => void
  /** Rejects once signal aborts, after any process it started has exited. */
  spawnSidecar: (distro: string, signal: AbortSignal) => Promise<RunningSidecar>
  installCli: (distro: string, cli: WslCliBuild) => Promise<void>
  readServers: () => WslServerConfig[]
  writeServers: (servers: WslServerConfig[]) => void
}

export type WslServersController = ReturnType<typeof createWslServersController>

export function wslServerIdForDistro(distro: string) {
  return `wsl:${distro}`
}

export function createWslServersController(options: WslServersControllerOptions) {
  const t = options.t
  const runtime = options.runtime
  let state: WslServersState = initialState()
  const listeners = new Set<() => void>()
  const sidecars = new Map<string, RunningSidecar>()
  // Starts in flight. Stopping one aborts its CLI discovery and health polling and waits until its process exited,
  // so a restart, reload, disable or quit never leaves a sidecar running beside or after it.
  const starts = new Map<string, { readonly abort: AbortController; readonly done: Promise<void> }>()
  let closed = false

  const emit = () => {
    for (const listener of listeners) listener()
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
    const persisted = options.readServers()

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
    const resolved = await runtime.resolveCli(distro)
    const version = resolved ? await runtime.readCliVersion(resolved, distro) : null

    return cliCheck(t, distro, resolved, version, options.cli.version)
  }

  const refreshCliCheck = async (distro: string) => {
    const check = await inspectCli(distro)
    setCliCheck(distro, check)

    return check
  }

  const probeAddableDistros = async (distros: readonly string[]) => {
    const unique = [...new Set(distros)]

    const distroProbes = await Promise.all(
      unique.flatMap((distro) =>
        state.distroProbes[distro] ? [] : [runtime.probeDistro(distro).then((probe) => [distro, probe] as const)],
      ),
    )

    if (distroProbes.length) {
      setState({ distroProbes: { ...state.distroProbes, ...Object.fromEntries(distroProbes) } })
    }

    const opencodeChecks = await Promise.all(
      unique.flatMap((distro) =>
        distroProbeReady(state.distroProbes[distro]) && !state.opencodeChecks[distro]
          ? [inspectCli(distro).then((check) => [distro, check] as const)]
          : [],
      ),
    )

    if (opencodeChecks.length) {
      setState({ opencodeChecks: { ...state.opencodeChecks, ...Object.fromEntries(opencodeChecks) } })
    }
  }

  const refreshCliCheckSafely = (id: string, distro: string) => {
    return refreshCliCheck(distro).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      options.log("error", "wsl CLI check failed", { id, distro, message })
    })
  }

  const refreshCliChecks = async () => {
    await Promise.all(state.servers.map((item) => refreshCliCheckSafely(item.config.id, item.config.distro)))
  }

  const refreshDistroLists = async () => {
    const [installed, online] = await Promise.all([runtime.listInstalled(), runtime.listOnline()])

    return { installed, online }
  }

  const startServer = async (id: string) => {
    const item = state.servers.find((x) => x.config.id === id)

    if (!item) return
    await stopServer(id)

    if (closed) return
    const abort = new AbortController()
    const startup = { abort, done: launch(id, item.config.distro, abort) }
    starts.set(id, startup)
    await startup.done
  }

  const launch = async (id: string, distro: string, abort: AbortController) => {
    // A later start or a stop replaced this one.
    const current = () => starts.get(id)?.abort === abort
    setRuntime(id, { kind: "starting" })
    options.log("info", "wsl sidecar starting", { id, distro })

    try {
      const sidecar = await options.spawnSidecar(distro, abort.signal)

      if (!current()) {
        await sidecar.stop()

        return
      }

      starts.delete(id)
      sidecars.set(id, sidecar)
      setRuntime(id, {
        kind: "ready",
        url: sidecar.url,
        password: sidecar.password,
      })
      sidecar.onExit((code, signal) => {
        if (sidecars.get(id) !== sidecar) return
        sidecars.delete(id)
        const message = t("error.serverExited", { code: code ?? "null", signal: signal ?? "null" })
        setRuntime(id, { kind: "failed", message })
        options.log("error", "wsl sidecar exited", { id, distro, code, signal })
      })
      void refreshCliCheckSafely(id, distro)
      options.log("info", "wsl sidecar ready", { id, distro, url: sidecar.url })
    } catch (error) {
      if (!current()) return
      starts.delete(id)
      const message = error instanceof Error ? error.message : String(error)
      setRuntime(id, { kind: "failed", message })
      options.log("error", "wsl sidecar failed to start", { id, distro, message })
    }
  }

  const stopServer = async (id: string) => {
    const startup = starts.get(id)
    starts.delete(id)
    startup?.abort.abort()
    await startup?.done
    const existing = sidecars.get(id)
    sidecars.delete(id)
    await existing?.stop()

    if (startup || existing) setRuntime(id, { kind: "stopped" })
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
    subscribe(listener: () => void) {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },

    startConfiguredServers() {
      closed = false
      refreshFromStore()
      void refreshCliChecks()
      state.servers.forEach((item) => void startServer(item.config.id))
    },

    async probeRuntime() {
      await runJob({ kind: "runtime", startedAt: Date.now() }, async () => {
        const next = await runtime.probeRuntime()
        setState({
          runtime: next,
          pendingRestart: state.pendingRestart && !next.available ? state.pendingRestart : false,
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
        await runtime.installRuntimeElevated()
        const next = await runtime.probeRuntime()
        setState({ runtime: next, pendingRestart: !next.available })
      })
    },

    async installDistro(distro: string) {
      await runJob({ kind: "install-distro", distro, startedAt: Date.now() }, async () => {
        await runtime.installDistro(distro)
        const distros = await refreshDistroLists()
        const probe = await runtime.probeDistro(distro)
        setState({
          ...distros,
          distroProbes: { ...state.distroProbes, [distro]: probe },
        })
      })
    },

    async probeAddable(distros: readonly string[]) {
      if (!distros.length) return
      await runJob({ kind: "probe-addable", distros, startedAt: Date.now() }, () => probeAddableDistros(distros))
    },

    async installOpencode(distro: string) {
      await runJob({ kind: "install-opencode", distro, startedAt: Date.now() }, async () => {
        const id = state.servers.find((item) => item.config.distro === distro)?.config.id

        if (id) await stopServer(id)
        await options.installCli(distro, options.cli)
        requireMatchingCli(t, await refreshCliCheck(distro), options.cli.version)

        if (id) await startServer(id)
      })
    },

    async addServer(distro: string): Promise<WslServerConfig> {
      const id = wslServerIdForDistro(distro)

      if (state.servers.some((item) => item.config.id === id)) {
        throw new Error(t("error.alreadyAdded", { distro }))
      }

      const config: WslServerConfig = {
        id,
        distro,
      }

      options.writeServers([...options.readServers(), config])
      setState({
        servers: [...state.servers, { config, runtime: { kind: "starting" } }],
      })
      void startServer(id)

      return config
    },

    async removeServer(id: string) {
      const distro = state.servers.find((item) => item.config.id === id)?.config.distro
      await stopServer(id)
      const remaining = options.readServers().filter((item) => item.id !== id)
      options.writeServers(remaining)
      const servers = state.servers.filter((item) => item.config.id !== id)

      setState(distro ? { servers, ...removeDistroState(state, distro) } : { servers })
    },

    startServer,

    async stopServers() {
      closed = true
      const pending = [...starts.values()]
      starts.clear()
      pending.forEach((startup) => startup.abort.abort())
      await Promise.all([
        ...pending.map((startup) => startup.done),
        ...[...sidecars.values()].map((sidecar) => sidecar.stop()),
      ])
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

function cliCheck(
  t: MainContext["t"],
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
      error: t("error.opencodeMissing"),
    }
  }

  if (!version) {
    return {
      distro,
      resolvedPath,
      version: null,
      expectedVersion,
      matchesDesktop: null,
      error: t("error.opencodeCannotRun"),
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

function requireMatchingCli(t: MainContext["t"], check: WslOpencodeCheck, expected: string) {
  if (check.version === expected) return
  throw new Error(
    t("error.updateVersion", {
      distro: check.distro,
      installed: check.version ?? t("error.noVersion"),
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
