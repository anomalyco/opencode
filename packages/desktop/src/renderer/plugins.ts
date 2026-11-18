import { Predicate } from "effect"
import type { Bridge, BridgeMessage } from "@opencode/plugin/gui/host"
import type { PluginFailure } from "../shared/ipc-rpc/plugins"
import { getOwner, onCleanup } from "solid-js"
import { api } from "./api"
import { cancellable, invoke, listen, send } from "./ipc-client"
import {
  createPluginBridgeState,
  selectPluginSubscriptions,
  transitionPluginBridge,
  type PluginBridgeEffect,
  type PluginBridgeEvent,
  type PluginBridgeSubscription,
} from "./plugins-machine"

/** The renderer end of the GUI plugin bridge; main hosts every Ipc and embed. */
export function createPluginBridge(): Bridge {
  let state = createPluginBridgeState()
  // Edge handles only: the unsubscribers of main's plugin events while attached.
  let stops: (() => void)[] = []

  const dispatch = (event: PluginBridgeEvent) => {
    const next = transitionPluginBridge(state, event)
    state = next.state
    next.effects.forEach(run)
  }

  const receive = (message: BridgeMessage) =>
    selectPluginSubscriptions(state).forEach((subscription) => subscription.listener(message))

  const run = (effect: PluginBridgeEffect) => {
    if (effect.type === "attach") {
      stops = [
        listen("PluginState", (event) => receive({ type: "state", ipc: event.ipc, state: event.state })),
        listen("PluginEvent", (event) =>
          receive({ type: "event", ipc: event.ipc, name: event.name, data: event.data }),
        ),
        listen("PluginAvailable", (event) =>
          receive({ type: "available", ipc: event.ipc, available: event.available }),
        ),
        listen("PluginsChanged", (event) => receive({ type: "installed", list: event.list })),
        listen("WindowFocusChanged", (event) => receive({ type: "focus", focused: event.focused })),
        listen("PluginGuisChanged", (event) =>
          receive({ type: "pluginGuis", plugins: event.plugins, reserved: event.reserved }),
        ),
        listen("PluginMenubarItemsChanged", (event) => dispatch({ type: "menubar.changed", items: event.items })),
      ]

      return
    }

    if (effect.type === "detach") {
      stops.forEach((stop) => stop())
      stops = []

      return
    }

    if (effect.type === "seed-menubar") {
      void invoke("PluginMenubarItems").then(
        (items) => dispatch({ type: "menubar.seeded", attempt: effect.attempt, items }),
        (cause: unknown) => dispatch({ type: "menubar.seed-failed", attempt: effect.attempt, cause }),
      )

      return
    }

    if (effect.type === "log-seed-error") {
      console.error("[plugin] menubar items failed", effect.cause)

      return
    }

    const message: BridgeMessage = { type: "menubarItems", items: effect.items }
    effect.subscriptions.forEach((subscription) => subscription.listener(message))
  }

  if (getOwner()) onCleanup(() => dispatch({ type: "disposed" }))

  return {
    packaged: api.getWindowBootstrap().packaged ?? false,
    call: (input, signal) =>
      cancellable("PluginCall", input, signal).catch((cause: unknown) => {
        throw failure(cause)
      }),
    subscribe: (ipc) => invoke("PluginSubscribe", { ipc }),
    on(listener) {
      const subscription: PluginBridgeSubscription = { listener }
      dispatch({ type: "listener.added", subscription })

      return () => dispatch({ type: "listener.removed", subscription })
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
