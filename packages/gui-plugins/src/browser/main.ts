import { builtinMainContext } from "@opencode/plugin/gui/builtin"
import type { Plugin } from "@opencode/plugin/gui/main"
import type { Pane } from "./pane"
import { RefsStore } from "./refs"
import { BrowserPane } from "./ipc"
import {
  createMainPaneState,
  isLoadingPaneAttempt,
  selectPane,
  transitionMainPane,
  type MainPaneEvent,
} from "./main-machine"

const setup: Plugin.MainSetup = (ctx) => {
  let paneState = createMainPaneState<Pane>()
  const loads = new Map<number, ReturnType<typeof Promise.withResolvers<Pane>>>()
  let disposing: Promise<void> | undefined
  const refs = ctx.storage.store("refs", RefsStore)

  const dispatch = (event: MainPaneEvent<Pane>) => {
    const next = transitionMainPane(paneState, event)
    paneState = next.state
    next.effects.forEach((effect) => {
      switch (effect.type) {
        case "load-pane":
          loads.set(effect.attempt, Promise.withResolvers())
          // The pane brings the CDP driver and the full RPC client with every protocol schema;
          // load it when a window first registers a pane instead of at startup.
          void import("./pane")
            .then((module) => {
              // Cleanup ran while the module loaded: create no pane, so no runtime outlives the plugin.
              if (!isLoadingPaneAttempt(paneState, effect.attempt)) return
              dispatch({
                type: "load.succeeded",
                attempt: effect.attempt,
                pane: module.createBrowserPane({
                  windows: ctx.windows,
                  serverEndpoints: ctx.serverEndpoints,
                  storage: builtinMainContext(ctx).storage,
                  refs,
                  embeds: ctx.embeds,
                  emit: (window, value) => provider.emit("event", value, window),
                }),
              })
            })
            .catch((cause: unknown) => dispatch({ type: "load.failed", attempt: effect.attempt, cause }))
          return
        case "resolve-load":
          loads.get(effect.attempt)?.resolve(effect.pane)
          loads.delete(effect.attempt)
          return
        case "reject-load":
          loads.get(effect.attempt)?.reject(effect.cause)
          loads.delete(effect.attempt)
          return
        case "dispose-pane":
          disposing = effect.pane.dispose()
      }
    })
  }

  // Every call but register names a binding, and bindings exist only after a register loaded the pane.
  const pane = () => {
    const lookup = selectPane(paneState)

    if (lookup.kind === "ready") return Promise.resolve(lookup.pane)
    const load = lookup.kind === "pending" ? loads.get(lookup.attempt) : undefined

    return load ? load.promise : Promise.reject(new Error("browser.pane.unavailable"))
  }

  const load = () => {
    dispatch({ type: "load.requested" })

    return pane()
  }

  const provider = ctx.provide(BrowserPane, {
    register: async (input, caller) => (await load()).register(caller.window, input.binding, input),
    load: async (input, caller) => (await pane()).load(caller.window, input.binding, input.tabID),
    command: async (input, caller) => (await pane()).command(caller.window, input.binding, input.command),
    inspect: async (input, caller) => (await pane()).inspect(caller.window, input.binding, input.tabID, input.enabled),
    highlight: async (input, caller) => (await pane()).highlight(caller.window, input.binding, input.tabID, input.ref),
    zoom: async (input, caller) => (await pane()).zoom(caller.window, input.binding, input.tabID, input.zoom),
    site: async (input, caller) => (await pane()).site(caller.window, input.binding, input.tabID),
    clearSite: async (input, caller) => (await pane()).clearSite(caller.window, input.binding, input.tabID),
    close: async (input, caller) => (await pane()).close(caller.window, input.binding),
  })

  // The host withdraws the Ipc before this runs, so windows hear nothing; they suspend on the Ipc going away.
  ctx.onCleanup(async () => {
    dispatch({ type: "disposed" })
    await disposing
  })
}

export default setup
