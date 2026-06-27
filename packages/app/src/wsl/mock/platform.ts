import type {
  WslDistroProbe,
  WslJob,
  WslOpencodeCheck,
  WslServerConfig,
  WslServersEvent,
  WslServersPlatform,
  WslServersState,
} from "../types"
import pkg from "../../../package.json"
import { ACTIVE_WSL_MOCK_SCENARIO, createWslMockState, type WslMockScenario } from "./scenarios"

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const mockSidecarUrl = "http://127.0.0.1:4096"

function wslServerId(distro: string) {
  return `wsl:${distro}`
}

function readyProbe(name: string): WslDistroProbe {
  return { name, canExecute: true, hasBash: true, hasCurl: true, error: null }
}

function readyOpencode(distro: string): WslOpencodeCheck {
  return {
    distro,
    resolvedPath: `/home/dev/.opencode/bin/opencode`,
    version: pkg.version,
    expectedVersion: pkg.version,
    matchesDesktop: true,
    error: null,
  }
}

export function createWslMockPlatform(scenario: WslMockScenario = ACTIVE_WSL_MOCK_SCENARIO): WslServersPlatform {
  let state = createWslMockState(scenario)
  const listeners = new Set<(event: WslServersEvent) => void>()

  const emit = () => {
    for (const listener of listeners) listener({ type: "state", state })
  }

  const setState = (next: Partial<WslServersState>) => {
    state = { ...state, ...next }
    emit()
  }

  const runJob = async (job: WslJob, work: () => Promise<void>) => {
    setState({ job })
    await delay(450)
    await work()
    setState({ job: null })
  }

  return {
    getState: async () => structuredClone(state),

    subscribe(cb) {
      listeners.add(cb)
      cb({ type: "state", state: structuredClone(state) })
      return () => listeners.delete(cb)
    },

    probeRuntime: async () => {
      await runJob({ kind: "runtime", startedAt: Date.now() }, async () => {
        if (state.runtime?.available) return
        if (scenario === "wslUnavailable") {
          setState({
            runtime: { available: false, version: null, error: "WSL is not installed. Run `wsl --install` to enable it." },
          })
          return
        }
        if (scenario === "wslRuntimeError") {
          setState({ runtime: { available: false, version: null, error: "wsl.exe --version timed out after 20000ms" } })
          return
        }
        setState({ runtime: { available: true, version: "WSL version: 2.6.1.0", error: null } })
      })
    },

    refreshDistros: async () => {
      await runJob({ kind: "distros", startedAt: Date.now() }, async () => {
        if (state.installed.length || state.online.length) return
        setState({
          installed: [{ name: "Ubuntu-24.04", version: 2, isDefault: true }],
          online: [
            { name: "Ubuntu-24.04", label: "Ubuntu 24.04 LTS" },
            { name: "Ubuntu-22.04", label: "Ubuntu 22.04 LTS" },
            { name: "Debian", label: "Debian GNU/Linux" },
          ],
        })
      })
    },

    installWsl: async () => {
      await runJob({ kind: "install-wsl", startedAt: Date.now() }, async () => {
        setState({ pendingRestart: true, runtime: { available: false, version: null, error: null } })
      })
    },

    installDistro: async (name) => {
      await runJob({ kind: "install-distro", distro: name, startedAt: Date.now() }, async () => {
        const installed = state.installed.some((item) => item.name === name)
          ? state.installed
          : [...state.installed, { name, version: 2, isDefault: state.installed.length === 0 }]
        setState({ installed })
      })
    },

    probeDistro: async (name) => {
      await runJob({ kind: "probe-distro", distro: name, startedAt: Date.now() }, async () => {
        setState({ distroProbes: { ...state.distroProbes, [name]: readyProbe(name) } })
      })
    },

    probeOpencode: async (name) => {
      await runJob({ kind: "probe-opencode", distro: name, startedAt: Date.now() }, async () => {
        setState({ opencodeChecks: { ...state.opencodeChecks, [name]: readyOpencode(name) } })
      })
    },

    installOpencode: async (name) => {
      await runJob({ kind: "install-opencode", distro: name, startedAt: Date.now() }, async () => {
        setState({ opencodeChecks: { ...state.opencodeChecks, [name]: readyOpencode(name) } })
      })
    },

    openTerminal: async (name) => {
      console.info("[wsl-mock] open terminal", name)
    },

    addServer: async (distro) => {
      const config: WslServerConfig = { id: wslServerId(distro), distro }
      const servers = state.servers.some((item) => item.config.id === config.id)
        ? state.servers
        : [...state.servers, { config, runtime: { kind: "starting" as const } }]
      setState({ servers })
      await delay(600)
      setState({
        servers: servers.map((item) =>
          item.config.id === config.id
            ? {
                ...item,
                runtime: {
                  kind: "ready",
                  url: mockSidecarUrl,
                  username: "opencode",
                  password: "mock-wsl-password",
                },
              }
            : item,
        ),
      })
      return config
    },

    removeServer: async (id) => {
      setState({ servers: state.servers.filter((item) => item.config.id !== id) })
    },

    startServer: async (id) => {
      const item = state.servers.find((server) => server.config.id === id)
      if (!item) return
      setState({
        servers: state.servers.map((server) =>
          server.config.id === id ? { ...server, runtime: { kind: "starting" } } : server,
        ),
      })
      await delay(600)
      setState({
        servers: state.servers.map((server) =>
          server.config.id === id
            ? {
                ...server,
                runtime: {
                  kind: "ready",
                  url: mockSidecarUrl,
                  username: "opencode",
                  password: "mock-wsl-password",
                },
              }
            : server,
        ),
      })
    },
  }
}
