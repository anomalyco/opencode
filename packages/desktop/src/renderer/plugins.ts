import { Predicate } from "effect"
import type { Bridge, BridgeMessage } from "@opencode/plugin/gui/host"
import type { PluginFailure } from "../shared/ipc-rpc/plugins"
import { api } from "./api"
import { cancellable, invoke, listen, send } from "./ipc-client"

/** The listeners' attachment to main's plugin events, while any listener is registered. */
type Attachment = { stop?: () => void }

/** The renderer end of the GUI plugin bridge; main hosts every Ipc and embed. */
export function createPluginBridge(): Bridge {
  const listeners = new Set<(message: BridgeMessage) => void>()
  const dispatch = (message: BridgeMessage) => listeners.forEach((listener) => listener(message))
  const attached: Attachment = {}
  // MenubarItem contributions change through events; a window that starts listening late asks once.
  const menubar = { revision: 0 }

  const attach = () => {
    const stops = [
      listen("PluginState", (event) => dispatch({ type: "state", ipc: event.ipc, state: event.state })),
      listen("PluginEvent", (event) => dispatch({ type: "event", ipc: event.ipc, name: event.name, data: event.data })),
      listen("PluginAvailable", (event) => dispatch({ type: "available", ipc: event.ipc, available: event.available })),
      listen("PluginsChanged", (event) => dispatch({ type: "installed", list: event.list })),
      listen("WindowFocusChanged", (event) => dispatch({ type: "focus", focused: event.focused })),
      listen("PluginGuisChanged", (event) =>
        dispatch({ type: "pluginGuis", plugins: event.plugins, reserved: event.reserved }),
      ),
      listen("PluginMenubarItemsChanged", (event) => {
        menubar.revision++
        dispatch({ type: "menubarItems", items: event.items })
      }),
    ]

    const revision = menubar.revision
    void invoke("PluginMenubarItems")
      .then((items) => {
        if (attached.stop && menubar.revision === revision) dispatch({ type: "menubarItems", items })
      })
      .catch((cause: unknown) => console.error("[plugin] menubar items failed", cause))

    return () => stops.forEach((stop) => stop())
  }

  return {
    packaged: api.getWindowBootstrap().packaged ?? false,
    call: (input, signal) =>
      cancellable("PluginCall", input, signal).catch((cause: unknown) => {
        throw failure(cause)
      }),
    subscribe: (ipc) => invoke("PluginSubscribe", { ipc }),
    on(listener) {
      listeners.add(listener)
      attached.stop ??= attach()

      return () => {
        listeners.delete(listener)

        if (listeners.size > 0) return
        attached.stop?.()
        attached.stop = undefined
      }
    },
    embed: (id, layout) => send("PluginEmbed", { id, layout }),
    capture: (id) => invoke("PluginCapture", { id }).then((data) => data ?? undefined),
    runMenubarItem: (id) => send("PluginMenubarItem", { id }),
    configure: (servers) => send("PluginConfigure", { servers }),
    pluginGuis: () => invoke("PluginGuis"),
    manager: {
      initial: window.electron.plugins,
      list: () => invoke("PluginList"),
      enable: (id) => manage(invoke("PluginEnable", { id })),
      disable: (id) => manage(invoke("PluginDisable", { id })),
      reload: (id) => manage(invoke("PluginReload", { id })),
    },
  }
}

function manage<Value>(request: Promise<Value>) {
  return request.catch((cause: unknown) => {
    throw failure(cause)
  })
}

// Main fails with a code the renderer host maps to its own copy; the code is also the message.
function failure(cause: unknown) {
  if (!isFailure(cause)) return cause

  return Object.assign(new Error(cause.message ?? cause.code), { code: cause.code })
}

function isFailure(error: unknown): error is PluginFailure {
  return Predicate.hasProperty(error, "code") && Predicate.isString(error.code)
}
