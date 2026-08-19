import { app } from "electron"
import type { WebContents } from "electron"
import type { WslServerConfig, WslServersState } from "@opencode-ai/app/wsl/types"
import { WslServersChanged } from "../../shared/ipc-rpc/events"
import { emitIpcEvent } from "../ipc-events"
import type { WslServersController } from "./servers"
import { nativeT } from "../native/translations"

export type WslIpc = {
  subscribe(sender: WebContents): void
  unsubscribe(id: number): void
  getState(): WslServersState
  probeRuntime(): Promise<void>
  refreshDistros(): Promise<void>
  installWsl(): Promise<void>
  installDistro(value: string): Promise<void>
  probeAddable(value: string[]): Promise<void>
  installOpencode(value: string): Promise<void>
  openTerminal(value: string): Promise<void>
  addServer(value: string): Promise<WslServerConfig>
  removeServer(value: string): Promise<void>
  startServer(value: string): Promise<void>
}

export function createDeferredWslIpc() {
  let current: WslIpc | undefined
  const get = () => {
    if (!current) throw new Error("WSL service is not initialized")
    return current
  }
  return {
    ipc: {
      subscribe: (sender) => get().subscribe(sender),
      unsubscribe: (id) => get().unsubscribe(id),
      getState: () => get().getState(),
      probeRuntime: () => get().probeRuntime(),
      refreshDistros: () => get().refreshDistros(),
      installWsl: () => get().installWsl(),
      installDistro: (value) => get().installDistro(value),
      probeAddable: (value) => get().probeAddable(value),
      installOpencode: (value) => get().installOpencode(value),
      openTerminal: (value) => get().openTerminal(value),
      addServer: (value) => get().addServer(value),
      removeServer: (value) => get().removeServer(value),
      startServer: (value) => get().startServer(value),
    } satisfies WslIpc,
    set: (ipc: WslIpc) => {
      current = ipc
    },
  }
}

export function createWslIpc(controller?: WslServersController): WslIpc {
  if (!controller) return createUnavailableWslIpc()

  const subscriptions = new Map<number, () => void>()
  const unsubscribe = (id: number) => {
    const off = subscriptions.get(id)
    if (!off) return
    off()
    subscriptions.delete(id)
  }

  app.once("will-quit", () => {
    subscriptions.forEach((off) => off())
    subscriptions.clear()
  })

  return {
    subscribe(sender) {
      const id = sender.id
      if (subscriptions.has(id)) return
      subscriptions.set(
        id,
        controller.subscribe((payload) => {
          if (sender.isDestroyed()) {
            unsubscribe(id)
            return
          }
          emitIpcEvent(sender, new WslServersChanged({ event: payload }))
        }),
      )
      sender.once("destroyed", () => unsubscribe(id))
    },
    unsubscribe,
    getState: () => controller.getState(),
    probeRuntime: () => controller.probeRuntime(),
    refreshDistros: () => controller.refreshDistros(),
    installWsl: () => controller.installWsl(),
    installDistro: (value) => controller.installDistro(requireWslIpcString("distro", value)),
    probeAddable: (value) => controller.probeAddable(requireWslIpcStrings("distro", value)),
    installOpencode: (value) => controller.installOpencode(requireWslIpcString("distro", value)),
    openTerminal: (value) => controller.openTerminal(requireWslIpcString("distro", value)),
    addServer: (value) => controller.addServer(requireWslIpcString("distro", value)),
    removeServer: (value) => controller.removeServer(requireWslIpcString("server id", value)),
    startServer: (value) => controller.startServer(requireWslIpcString("server id", value)),
  }
}

function createUnavailableWslIpc(): WslIpc {
  const unavailable = () => {
    throw new Error(nativeT("desktop.wsl.error.windowsOnly"))
  }
  const state = (): WslServersState => ({
    runtime: {
      available: false,
      version: null,
      error: nativeT("desktop.wsl.error.windowsOnly"),
    },
    installed: [],
    online: [],
    distroProbes: {},
    opencodeChecks: {},
    pendingRestart: false,
    servers: [],
    job: null,
  })

  return {
    subscribe: (sender) => emitIpcEvent(sender, new WslServersChanged({ event: { type: "state", state: state() } })),
    unsubscribe: () => undefined,
    getState: state,
    probeRuntime: unavailable,
    refreshDistros: unavailable,
    installWsl: unavailable,
    installDistro: unavailable,
    probeAddable: unavailable,
    installOpencode: unavailable,
    openTerminal: unavailable,
    addServer: unavailable,
    removeServer: unavailable,
    startServer: unavailable,
  }
}

function requireWslIpcString(name: string, value: unknown) {
  if (typeof value === "string" && value.length > 0) return value
  throw new Error(`Invalid ${name}`)
}

function requireWslIpcStrings(name: string, value: unknown) {
  if (!Array.isArray(value)) throw new Error(`Invalid ${name}`)
  const values = value.map((item) => requireWslIpcString(name, item))
  if (values.length) return values
  throw new Error(`Invalid ${name}`)
}
