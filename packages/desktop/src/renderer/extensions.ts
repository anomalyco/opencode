import type { Bridge, BridgeMessage } from "@opencode/gui-extensions/sdk/bridge"
import type { ExtensionFailure } from "../shared/ipc-rpc/extensions"
import { cancellable, invoke, listen, send } from "./ipc-client"

/** The renderer end of the GUI extension bridge; main hosts every remote, surface, and archive. */
export function createExtensionBridge(): Bridge {
  const listeners = new Set<(message: BridgeMessage) => void>()
  const dispatch = (message: BridgeMessage) => listeners.forEach((listener) => listener(message))
  const attached: { stop?: () => void } = {}
  // Menubar contributions change through events; a window that starts listening late asks once.
  const menubar = { revision: 0 }
  const attach = () => {
    const stops = [
      listen("ExtensionState", (event) => dispatch({ type: "state", remote: event.remote, state: event.state })),
      listen("ExtensionEvent", (event) =>
        dispatch({ type: "event", remote: event.remote, name: event.name, data: event.data }),
      ),
      listen("ExtensionAvailable", (event) =>
        dispatch({ type: "available", remote: event.remote, available: event.available }),
      ),
      listen("ExtensionsChanged", (event) => dispatch({ type: "extensions", list: event.list })),
      listen("ExtensionMenubarChanged", (event) => {
        menubar.revision++
        dispatch({ type: "menubar", items: event.items })
      }),
    ]
    const revision = menubar.revision
    void invoke("ExtensionMenubarItems").then((items) => {
      if (attached.stop && menubar.revision === revision) dispatch({ type: "menubar", items })
    })
    return () => stops.forEach((stop) => stop())
  }

  return {
    call: (input, signal) =>
      cancellable("ExtensionCall", input, signal).catch((error: unknown) => {
        throw failure(error)
      }),
    subscribe: (remote) => invoke("ExtensionSubscribe", { remote }),
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
    surface: (id, layout) => send("ExtensionSurface", { id, layout }),
    capture: (id) => invoke("ExtensionCapture", { id }).then((data) => data ?? undefined),
    menubar: (id) => send("ExtensionMenubar", { id }),
    configure: (servers) => send("ExtensionConfigure", { servers }),
    manager: {
      list: () => invoke("ExtensionList"),
      enable: (id) => manage(invoke("ExtensionEnable", { id })),
      disable: (id) => manage(invoke("ExtensionDisable", { id })),
      reload: (id) => manage(invoke("ExtensionReload", { id })),
      install: (source) =>
        manage(invoke("ExtensionInstall", { source: typeof source === "string" ? source : new Uint8Array(source) })),
      remove: (id) => manage(invoke("ExtensionRemove", { id })),
      source: (id) => manage(invoke("ExtensionSource", { id })),
      asset: (id, path) =>
        `oc://extensions/${encodeURIComponent(id)}/${path.split("/").map(encodeURIComponent).join("/")}`,
    },
  }
}

function manage<Value>(request: Promise<Value>) {
  return request.catch((error: unknown) => {
    throw failure(error)
  })
}

// Main fails with a code the renderer host maps to its own copy; the code is also the message.
function failure(error: unknown) {
  if (!isFailure(error)) return error
  return Object.assign(new Error(error.message ?? error.code), { code: error.code })
}

function isFailure(error: unknown): error is ExtensionFailure {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
}
