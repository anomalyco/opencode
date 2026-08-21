export * as WslIpc from "./ipc"

import { app } from "electron"
import type { WebContents } from "electron"
import type { WslServerConfig, WslServersState } from "@opencode-ai/app/wsl/types"
import { Effect } from "effect"
import { WslServersChanged } from "../../shared/ipc-rpc/events"
import { emitIpcEvent } from "../ipc-events"
import type { WslServersController } from "./servers"
import { nativeT } from "../native/translations"

export interface Interface {
  readonly subscribe: (sender: WebContents) => Effect.Effect<void>
  readonly unsubscribe: (id: number) => Effect.Effect<void>
  readonly getState: () => Effect.Effect<WslServersState>
  readonly probeRuntime: () => Effect.Effect<void>
  readonly refreshDistros: () => Effect.Effect<void>
  readonly installWsl: () => Effect.Effect<void>
  readonly installDistro: (value: string) => Effect.Effect<void>
  readonly probeAddable: (value: string[]) => Effect.Effect<void>
  readonly installOpencode: (value: string) => Effect.Effect<void>
  readonly openTerminal: (value: string) => Effect.Effect<void>
  readonly addServer: (value: string) => Effect.Effect<WslServerConfig>
  readonly removeServer: (value: string) => Effect.Effect<void>
  readonly startServer: (value: string) => Effect.Effect<void>
}

export function create(controller?: WslServersController): Interface {
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
    subscribe: (sender) =>
      Effect.sync(() => {
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
      }),
    unsubscribe: (id) => Effect.sync(() => unsubscribe(id)),
    getState: () => Effect.sync(() => controller.getState()),
    probeRuntime: () => promise(() => controller.probeRuntime()),
    refreshDistros: () => promise(() => controller.refreshDistros()),
    installWsl: () => promise(() => controller.installWsl()),
    installDistro: (value) => promise(() => controller.installDistro(requireWslIpcString("distro", value))),
    probeAddable: (value) => promise(() => controller.probeAddable(requireWslIpcStrings("distro", value))),
    installOpencode: (value) => promise(() => controller.installOpencode(requireWslIpcString("distro", value))),
    openTerminal: (value) => promise(() => controller.openTerminal(requireWslIpcString("distro", value))),
    addServer: (value) => promise(() => controller.addServer(requireWslIpcString("distro", value))),
    removeServer: (value) => promise(() => controller.removeServer(requireWslIpcString("server id", value))),
    startServer: (value) => promise(() => controller.startServer(requireWslIpcString("server id", value))),
  }
}

function promise<A>(evaluate: () => Promise<A>) {
  return Effect.tryPromise(evaluate).pipe(Effect.orDie)
}

function createUnavailableWslIpc(): Interface {
  const message = nativeT(
    process.platform === "win32" ? "desktop.wsl.error.unavailable" : "desktop.wsl.error.windowsOnly",
  )
  const unavailable = () => {
    throw new Error(message)
  }
  const state = (): WslServersState => ({
    runtime: {
      available: false,
      version: null,
      error: message,
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
    subscribe: (sender) =>
      Effect.sync(() => emitIpcEvent(sender, new WslServersChanged({ event: { type: "state", state: state() } }))),
    unsubscribe: () => Effect.void,
    getState: () => Effect.sync(state),
    probeRuntime: () => Effect.sync(unavailable),
    refreshDistros: () => Effect.sync(unavailable),
    installWsl: () => Effect.sync(unavailable),
    installDistro: () => Effect.sync(unavailable),
    probeAddable: () => Effect.sync(unavailable),
    installOpencode: () => Effect.sync(unavailable),
    openTerminal: () => Effect.sync(unavailable),
    addServer: () => Effect.sync(unavailable),
    removeServer: () => Effect.sync(unavailable),
    startServer: () => Effect.sync(unavailable),
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
