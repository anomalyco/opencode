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
}) {
  const root = document.getElementById("root")
  if (!root) throw new Error("Missing fixture root")
  const history = createMemoryHistory()
  history.set({ value: input.path ?? "/settings", replace: true, scroll: false })
  const endpoint = { url: input.wsl ?? input.server }
  const ready = () => ({ kind: "ready" as const, url: endpoint.url, password: null })
  const held = Promise.withResolvers<void>()
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
        installed: [],
        online: [],
        distroProbes: {},
        pendingRestart: false,
        job: null,
        servers: [
          {
            config: { id: "wsl:Ubuntu", distro: "Ubuntu" },
            runtime:
              input.mode === "ready"
                ? ready()
                : input.mode === "failed"
                  ? { kind: "failed", message: "WSL failed to start" }
                  : { kind: "stopped" },
          },
        ],
        opencodeChecks: {
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
    const snapshot = (remote: string) => structuredClone(unwrap(remote === "ssh" ? store.ssh : store.state))
    const publish = (remote: string) =>
      listeners.forEach((listener) => listener({ type: "state", remote, state: snapshot(remote) }))
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
    const methods: Record<string, Record<string, (input: { id?: string; name?: string }) => unknown>> = {
      wsl: {
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
      },
      ssh: {
        // Like main: a connect opens a new tunnel to a remote server with a new password.
        start() {
          setStore("connects", (count) => count + 1)
          setSsh({ stage: "ready", http: { url: input.ssh ?? "", password: `ssh-${store.connects + 1}` } })
          return store.ssh.revision
        },
      },
    }
    const bridge: Bridge = {
      async call(request) {
        const method = methods[request.remote]?.[request.method]
        if (!method) throw new Error("Unexpected fixture action")
        const result = method(request.input as { id?: string; name?: string })
        publish(request.remote)
        return result ?? null
      },
      async subscribe(remote) {
        if (remote === "wsl" || remote === "ssh") return { available: true, state: snapshot(remote) }
        return { available: false }
      },
      on(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      surface: () => undefined,
      capture: async () => undefined,
      menubar: () => undefined,
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
      ...(input.storage === "async" ? { storage } : {}),
    }
    function Interface() {
      const extensions = useExtensionServers()
      const servers = createMemo<ServerConnection.Any[]>(() => [
        { type: "sidecar", variant: "base", displayName: "Local Server", http: { url: input.server } },
        ...extensions.list(),
      ])
      return (
        <Show when={extensions.ready()}>
          <AppInterface
            servers={servers()}
            defaultServer={ServerConnection.Key.make("sidecar")}
            router={(props) => <MemoryRouter {...props} history={history} />}
          />
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
                listeners.forEach((listener) => listener({ type: "available", remote: "wsl", available }))
                if (available) publish("wsl")
              }}
            />
            WSL extension
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
