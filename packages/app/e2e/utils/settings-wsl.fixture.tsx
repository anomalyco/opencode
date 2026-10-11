import { MemoryRouter, createMemoryHistory } from "@solidjs/router"
import { createMemo, Show } from "solid-js"
import { createStore, unwrap } from "solid-js/store"
import { render } from "solid-js/web"
import type { Bridge, BridgeMessage } from "@opencode/gui-extensions/sdk/bridge"
import type { SshItem, SshState } from "../../../gui-extensions/src/ssh/contract"
import type { WslServerRuntime, WslServersState } from "../../../gui-extensions/src/wsl/contract"
import { AppBaseProviders, AppInterface } from "../../src/app"
import { PlatformProvider, type Platform } from "../../src/runtime/platform/platform"
import { ServerConnection } from "../../src/runtime/server/registry"
import { useExtensionServers } from "../../src/runtime/extension/servers"

/** The input of a WSL or SSH method this fixture answers. */
type FixtureInput = { id?: string; name?: string }

/** A main-side method: SSH `start` answers with the state revision, the others with nothing. */
type FixtureMethod = (input: FixtureInput) => number | void

// A desktop window. `wsl` is the Ubuntu server's endpoint (default `server`); updating OpenCode restarts it on `restart`
// (default `wsl`). `ssh` adds a saved SSH server `box`, ready on that endpoint with password `ssh-1`; each connect
// brings up a new remote server with the next password (`ssh-2`, ...). `storage=async` stores in localStorage behind
// asynchronous reads like the desktop app's; reads of keys containing `hold` wait for "Load held storage".
export function mount(input: {
  server: string
  mode: "failed" | "stopped" | "ready"
  wsl?: string | null
  restart?: string | null
  path?: string | null
  ssh?: string | null
  storage?: string | null
  hold?: string | null
  /** Comma-separated installed distributions for the add-server dialog. */
  distros?: string | null
  /** Holds the distribution refresh job while inspecting disabled dialog controls. */
  busy?: string | null
  /** Enables the updater Ipc; check and install reject with this message, which may be empty. */
  updater?: string | null
}) {
  const root = document.getElementById("root")

  if (!root) throw new Error("Missing fixture root")
  const history = createMemoryHistory()
  history.set({ value: input.path ?? "/settings", replace: true, scroll: false })
  const endpoint = { url: input.wsl ?? input.server }
  const ready = () => ({ kind: "ready" as const, url: endpoint.url, password: null })
  const held = Promise.withResolvers<void>()
  const distros = input.distros?.split(",").filter(Boolean) ?? []

  const storage = (name?: string) => {
    const item = (key: string) => (name ? `${name}:${key}` : key)

    return {
      getItem: async (key: string) => {
        if (input.hold && key.includes(input.hold)) await held.promise

        return localStorage.getItem(item(key))
      },
      setItem: async (key: string, value: string) => localStorage.setItem(item(key), value),
      removeItem: async (key: string) => localStorage.removeItem(item(key)),
    }
  }

  render(() => {
    const [store, setStore] = createStore<{
      calls: string[]
      connects: number
      available: boolean
      state: WslServersState
      ssh: SshState
    }>({
      calls: [],
      connects: 0,
      available: true,
      ssh: {
        revision: 0,
        servers: input.ssh
          ? [
              {
                config: { id: "box", target: "box", name: "box" },
                saved: true,
                stage: "ready",
                http: { url: input.ssh, password: "ssh-1" },
                detail: "",
              },
            ]
          : [],
      },
      state: {
        runtime: { available: true, version: "2", error: null },
        installed: distros.map((name) => ({ name, version: name === "Debian-WSL1" ? 1 : 2, isDefault: false })),
        online: distros.length
          ? ["Debian", "FedoraLinux-43", "openSUSE-Tumbleweed", "OracleLinux_9_1", "kali-linux"].map((name) => ({
              name,
              label: name,
            }))
          : [],
        distroProbes: Object.fromEntries(
          distros.map((name) => [name, { name, canExecute: true, hasBash: true, hasCurl: true, error: null }]),
        ),
        pendingRestart: false,
        job: input.busy ? { kind: "distros", startedAt: 0 } : null,
        servers: [
          {
            config: { id: "wsl:Ubuntu", distro: "Ubuntu" },
            runtime: (
              {
                ready: ready(),
                failed: { kind: "failed", message: "WSL failed to start" },
                stopped: { kind: "stopped" },
              } satisfies Record<typeof input.mode, WslServerRuntime>
            )[input.mode],
          },
        ],
        opencodeChecks: {
          ...Object.fromEntries(
            distros.map((name) => [
              name,
              {
                distro: name,
                resolvedPath: null,
                version: null,
                expectedVersion: "current",
                matchesDesktop: null,
                error: null,
              },
            ]),
          ),
          Ubuntu: {
            distro: "Ubuntu",
            resolvedPath: "/usr/bin/opencode",
            version: "old",
            expectedVersion: "current",
            matchesDesktop: false,
            error: null,
          },
        },
      },
    })

    // The main-process WSL and SSH extensions, as the extension bridge sees them.
    const listeners = new Set<(message: BridgeMessage) => void>()
    const snapshot = (ipc: string) => structuredClone(unwrap(ipc === "ssh" ? store.ssh : store.state))

    const publish = (ipc: string) =>
      listeners.forEach((listener) => listener({ type: "state", ipc, state: snapshot(ipc) }))

    // The contract state is deeply readonly, so each action replaces the changed branch.
    const setRuntime = (id: string | undefined, runtime: WslServerRuntime) =>
      setStore("state", (state) => ({
        servers: state.servers.map((server) => (server.config.id === id ? { ...server, runtime } : server)),
      }))

    const setSsh = (item: Partial<SshItem>) =>
      setStore("ssh", (state) => ({
        revision: state.revision + 1,
        servers: state.servers.map((server) => ({ ...server, ...item })),
      }))

    const wsl = {
      // Like main: stops the distro's server, updates OpenCode, then starts the server again on a new endpoint.
      installOpencode(value) {
        const name = value.name ?? ""
        const id = store.state.servers.find((server) => server.config.distro === name)?.config.id
        setStore("calls", (calls) => [...calls, `update:${value.name}`])
        setRuntime(id, { kind: "stopped" })
        publish("wsl")
        setStore("state", (state) => ({
          opencodeChecks: {
            ...state.opencodeChecks,
            [name]: { ...state.opencodeChecks[name]!, version: "current", matchesDesktop: true },
          },
        }))
        endpoint.url = input.restart ?? endpoint.url
        setRuntime(id, ready())
      },
      startServer(value) {
        setStore("calls", (calls) => [...calls, `start:${value.id}`])
        setRuntime(value.id, ready())
      },
      removeServer(value) {
        setStore("calls", (calls) => [...calls, `remove:${value.id}`])
        setStore("state", (state) => ({ servers: state.servers.filter((server) => server.config.id !== value.id) }))
      },
    } satisfies Readonly<Record<string, FixtureMethod>>

    const ssh = {
      // Like main: a connect opens a new tunnel to a remote server with a new password.
      start() {
        setStore("connects", (count) => count + 1)
        setSsh({ stage: "ready", http: { url: input.ssh ?? "", password: `ssh-${store.connects + 1}` } })

        return store.ssh.revision
      },
    } satisfies Readonly<Record<string, FixtureMethod>>

    const methods = new Map<string, Readonly<Record<string, FixtureMethod>>>([
      ["wsl", wsl],
      ["ssh", ssh],
    ])

    const bridge: Bridge = {
      packaged: false,
      async call(request) {
        if (request.ipc === "updater" && input.updater != null) throw new Error(input.updater)
        const method = methods.get(request.ipc)?.[request.method]

        if (!method) throw new Error("Unexpected fixture action")
        // SAFETY: every WSL and SSH method the fixture answers takes a struct of these optional string fields.
        const result = method(request.input as FixtureInput)
        publish(request.ipc)

        return result ?? null
      },
      async subscribe(ipc) {
        if (ipc === "updater" && input.updater != null) return { available: true, state: { status: "idle" } }

        if (ipc === "wsl" || ipc === "ssh") return { available: true, state: snapshot(ipc) }

        return { available: false }
      },
      on(listener) {
        listeners.add(listener)

        return () => listeners.delete(listener)
      },
      embed: () => undefined,
      capture: async () => undefined,
      runMenubarItem: () => undefined,
      configure: () => undefined,
      manager: {
        list: async () => [],
        enable: async () => undefined,
        disable: async () => undefined,
        reload: async () => undefined,
        install: async () => undefined,
        remove: async () => undefined,
        source: async () => "",
        asset: () => "",
      },
    }

    const unused = async () => {
      throw new Error("Unexpected fixture action")
    }

    const platform: Platform = {
      platform: "desktop",
      os: "windows",
      windowID: "settings-wsl-test",
      openExternal: () => undefined,
      openDirectoryPickerDialog: async () => null,
      notify: async () => undefined,
      restart: unused,
      extensions: bridge,
    }

    if (input.storage === "async") platform.storage = storage

    function Interface() {
      const extensions = useExtensionServers()

      const servers = createMemo<ServerConnection.Any[]>(() => [
        { type: "sidecar", variant: "base", displayName: "Local Server", http: { url: input.server } },
        ...extensions.list(),
      ])

      return (
        <Show when={extensions.ready()}>
          <AppInterface servers={servers()} router={(props) => <MemoryRouter {...props} history={history} />} />
        </Show>
      )
    }

    return (
      <PlatformProvider value={platform}>
        <AppBaseProviders locale="en">
          <output aria-label="WSL actions">{store.calls.join(",")}</output>
          {/* The WSL extension's main side going away, as on a reload or failure, and coming back. */}
          <label>
            <input
              type="checkbox"
              checked={store.available}
              onChange={(event) => {
                const available = event.currentTarget.checked
                setStore("available", available)
                listeners.forEach((listener) => listener({ type: "available", ipc: "wsl", available }))

                if (available) publish("wsl")
              }}
            />
            WSL extension
          </label>
          {/* The SSH extension's main side going away and coming back. */}
          <label>
            <input
              type="checkbox"
              checked
              onChange={(event) => {
                const available = event.currentTarget.checked
                listeners.forEach((listener) => listener({ type: "available", ipc: "ssh", available }))

                if (available) publish("ssh")
              }}
            />
            SSH extension
          </label>
          {/* The SSH tunnel dropping, which only main notices. */}
          <Show when={input.ssh}>
            <button
              type="button"
              onClick={() => {
                setSsh({ stage: "disconnected" })
                publish("ssh")
              }}
            >
              Drop SSH tunnel
            </button>
            {/* A background reconnect that needs a password, as main reports it to every window. */}
            <button
              type="button"
              onClick={() => {
                setSsh({ stage: "authentication" })
                publish("ssh")
              }}
            >
              Require SSH sign-in
            </button>
            <output aria-label="SSH connects">{store.connects}</output>
          </Show>
          <Show when={input.hold}>
            <button type="button" onClick={() => held.resolve()}>
              Load held storage
            </button>
          </Show>
          <Interface />
        </AppBaseProviders>
      </PlatformProvider>
    )
  }, root)
}
