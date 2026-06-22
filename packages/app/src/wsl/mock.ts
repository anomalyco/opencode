import type {
  WslDistroProbe,
  WslOpencodeCheck,
  WslServerConfig,
  WslServerItem,
  WslServersEvent,
  WslServersPlatform,
  WslServersState,
} from "./types"

export type WslMockScenario = "default" | "onboarding" | "servers" | "fresh"

const MOCK_VERSION = "1.17.9"
const DEFAULT_DISTRO = "Ubuntu-24.04"
const SECONDARY_DISTRO = "Debian"

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function distroProbe(name: string, ready = true): WslDistroProbe {
  return {
    name,
    canExecute: ready,
    hasBash: ready,
    hasCurl: ready,
    error: ready ? null : `${name} is not ready yet`,
  }
}

function opencodeCheck(distro: string, ready: boolean, outdated = false): WslOpencodeCheck {
  if (!ready) {
    return {
      distro,
      resolvedPath: null,
      version: null,
      expectedVersion: MOCK_VERSION,
      matchesDesktop: null,
      error: null,
    }
  }
  const version = outdated ? "1.14.0" : MOCK_VERSION
  return {
    distro,
    resolvedPath: `/home/dev/.opencode/bin/opencode`,
    version,
    expectedVersion: MOCK_VERSION,
    matchesDesktop: !outdated,
    error: null,
  }
}

function readyRuntime(url: string): WslServerItem["runtime"] {
  return { kind: "ready", url, username: "opencode", password: "mock" }
}

function initialState(scenario: WslMockScenario): WslServersState {
  if (scenario === "onboarding") {
    return {
      runtime: { available: false, version: null, error: "WSL is not installed" },
      installed: [],
      online: [],
      distroProbes: {},
      opencodeChecks: {},
      pendingRestart: false,
      servers: [],
      job: null,
    }
  }

  if (scenario === "fresh") {
    return {
      runtime: { available: true, version: "2.4.13.0", error: null },
      installed: [
        { name: DEFAULT_DISTRO, version: 2, isDefault: true },
        { name: SECONDARY_DISTRO, version: 2, isDefault: false },
      ],
      online: [
        { name: DEFAULT_DISTRO, label: "Ubuntu 24.04 LTS" },
        { name: SECONDARY_DISTRO, label: "Debian" },
        { name: "FedoraLinux-42", label: "Fedora Linux 42" },
      ],
      distroProbes: {
        [DEFAULT_DISTRO]: distroProbe(DEFAULT_DISTRO),
        [SECONDARY_DISTRO]: distroProbe(SECONDARY_DISTRO),
      },
      opencodeChecks: {
        [DEFAULT_DISTRO]: opencodeCheck(DEFAULT_DISTRO, false),
        [SECONDARY_DISTRO]: opencodeCheck(SECONDARY_DISTRO, true, true),
      },
      pendingRestart: false,
      servers: [],
      job: null,
    }
  }

  if (scenario === "servers") {
    return {
      runtime: { available: true, version: "2.4.13.0", error: null },
      installed: [
        { name: DEFAULT_DISTRO, version: 2, isDefault: true },
        { name: SECONDARY_DISTRO, version: 2, isDefault: false },
      ],
      online: [],
      distroProbes: {
        [DEFAULT_DISTRO]: distroProbe(DEFAULT_DISTRO),
        [SECONDARY_DISTRO]: distroProbe(SECONDARY_DISTRO),
      },
      opencodeChecks: {
        [DEFAULT_DISTRO]: opencodeCheck(DEFAULT_DISTRO, true),
        [SECONDARY_DISTRO]: opencodeCheck(SECONDARY_DISTRO, true, true),
      },
      pendingRestart: false,
      servers: [
        {
          config: { id: `wsl:${DEFAULT_DISTRO}`, distro: DEFAULT_DISTRO },
          runtime: readyRuntime("http://127.0.0.1:4097"),
        },
        {
          config: { id: `wsl:${SECONDARY_DISTRO}`, distro: SECONDARY_DISTRO },
          runtime: { kind: "starting" },
        },
        {
          config: { id: "wsl:FedoraLinux-42", distro: "FedoraLinux-42" },
          runtime: { kind: "failed", message: "Sidecar failed to start" },
        },
      ],
      job: null,
    }
  }

  return {
    runtime: { available: true, version: "2.4.13.0", error: null },
    installed: [
      { name: DEFAULT_DISTRO, version: 2, isDefault: true },
      { name: SECONDARY_DISTRO, version: 2, isDefault: false },
    ],
    online: [{ name: "FedoraLinux-42", label: "Fedora Linux 42" }],
    distroProbes: {
      [DEFAULT_DISTRO]: distroProbe(DEFAULT_DISTRO),
      [SECONDARY_DISTRO]: distroProbe(SECONDARY_DISTRO),
    },
    opencodeChecks: {
      [DEFAULT_DISTRO]: opencodeCheck(DEFAULT_DISTRO, true),
      [SECONDARY_DISTRO]: opencodeCheck(SECONDARY_DISTRO, true, true),
    },
    pendingRestart: false,
    servers: [
      {
        config: { id: `wsl:${SECONDARY_DISTRO}`, distro: SECONDARY_DISTRO },
        runtime: readyRuntime("http://127.0.0.1:4098"),
      },
    ],
    job: null,
  }
}

export function wslMockScenario(): WslMockScenario {
  if (typeof window === "undefined") return "default"
  const value = new URLSearchParams(window.location.search).get("wslMock")
  if (value === "onboarding" || value === "servers" || value === "fresh") return value
  return "default"
}

export function createMockWslServers(scenario: WslMockScenario = wslMockScenario()): WslServersPlatform {
  let state = initialState(scenario)
  const listeners = new Set<(event: WslServersEvent) => void>()

  const emit = () => {
    const snapshot = structuredClone(state)
    listeners.forEach((listener) => listener({ type: "state", state: snapshot }))
  }

  const setState = (next: Partial<WslServersState>) => {
    state = { ...state, ...next }
    emit()
  }

  const withJob = async <T>(job: WslServersState["job"], run: () => Promise<T>) => {
    setState({ job })
    await delay(600)
    const result = await run()
    setState({ job: null })
    return result
  }

  const serverId = (distro: string) => `wsl:${distro}`

  return {
    getState: async () => structuredClone(state),

    subscribe(cb) {
      listeners.add(cb)
      cb({ type: "state", state: structuredClone(state) })
      return () => listeners.delete(cb)
    },

    probeRuntime: () =>
      withJob({ kind: "runtime", startedAt: Date.now() }, async () => {
        setState({
          runtime: { available: true, version: "2.4.13.0", error: null },
          pendingRestart: false,
        })
      }),

    refreshDistros: () =>
      withJob({ kind: "distros", startedAt: Date.now() }, async () => {
        setState({
          installed: [
            { name: DEFAULT_DISTRO, version: 2, isDefault: true },
            { name: SECONDARY_DISTRO, version: 2, isDefault: false },
          ],
          online: [
            { name: DEFAULT_DISTRO, label: "Ubuntu 24.04 LTS" },
            { name: SECONDARY_DISTRO, label: "Debian" },
            { name: "FedoraLinux-42", label: "Fedora Linux 42" },
          ],
        })
      }),

    installWsl: () =>
      withJob({ kind: "install-wsl", startedAt: Date.now() }, async () => {
        setState({ runtime: { available: true, version: "2.4.13.0", error: null } })
      }),

    installDistro: (name) =>
      withJob({ kind: "install-distro", distro: name, startedAt: Date.now() }, async () => {
        const installed = state.installed.some((item) => item.name === name)
          ? state.installed
          : [...state.installed, { name, version: 2, isDefault: state.installed.length === 0 }]
        setState({ installed })
      }),

    probeDistro: (name) =>
      withJob({ kind: "probe-distro", distro: name, startedAt: Date.now() }, async () => {
        setState({
          distroProbes: { ...state.distroProbes, [name]: distroProbe(name) },
        })
      }),

    probeOpencode: (name) =>
      withJob({ kind: "probe-opencode", distro: name, startedAt: Date.now() }, async () => {
        const existing = state.opencodeChecks[name]
        setState({
          opencodeChecks: {
            ...state.opencodeChecks,
            [name]: existing?.resolvedPath ? existing : opencodeCheck(name, false),
          },
        })
      }),

    installOpencode: (name) =>
      withJob({ kind: "install-opencode", distro: name, startedAt: Date.now() }, async () => {
        setState({
          opencodeChecks: { ...state.opencodeChecks, [name]: opencodeCheck(name, true) },
        })
      }),

    openTerminal: async (name) => {
      console.info("[opencode] mock WSL openTerminal", name)
    },

    addServer: async (distro) => {
      const config: WslServerConfig = { id: serverId(distro), distro }
      setState({
        servers: [...state.servers.filter((item) => item.config.id !== config.id), { config, runtime: { kind: "starting" } }],
      })
      await delay(800)
      const servers = state.servers.map((item) =>
        item.config.id === config.id
          ? { ...item, runtime: readyRuntime(`http://127.0.0.1:${4096 + state.servers.length}`) }
          : item,
      )
      setState({ servers })
      return config
    },

    removeServer: async (id) => {
      setState({ servers: state.servers.filter((item) => item.config.id !== id) })
    },

    startServer: async (id) => {
      const servers = state.servers.map((item) =>
        item.config.id === id ? { ...item, runtime: { kind: "starting" } as const } : item,
      )
      setState({ servers })
      await delay(800)
      setState({
        servers: state.servers.map((item) =>
          item.config.id === id ? { ...item, runtime: readyRuntime("http://127.0.0.1:4099") } : item,
        ),
      })
    },
  }
}

export function devWslServers(input?: { os?: "macos" | "windows" | "linux" }) {
  if (!import.meta.env.DEV) return undefined
  if (input?.os === "windows") return undefined
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("wslMock") === "0") {
    return undefined
  }
  const scenario = wslMockScenario()
  console.info(
    `[opencode] Mock WSL servers enabled (scenario: ${scenario}). Use ?wslMock=onboarding|fresh|servers|default or ?wslMock=0 to disable.`,
  )
  return createMockWslServers(scenario)
}
