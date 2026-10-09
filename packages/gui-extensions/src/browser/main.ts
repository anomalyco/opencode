import type { MainSetup } from "../sdk/main"
import type definition from "./index"
import type { Pane } from "./pane"
import { BrowserPane } from "./ipc"

/** The pane once a window first registered one. */
type LoadedPane = { pane?: Promise<Pane> }

const setup: MainSetup<typeof definition> = (ctx) => {
  const loaded: LoadedPane = {}

  // The pane brings the CDP driver and the full RPC client with every protocol schema;
  // load it when a window first registers a pane instead of at startup.
  const load = () =>
    (loaded.pane ??= import("./pane").then((module) =>
      module.createBrowserPane({
        windows: ctx.windows,
        serverEndpoints: ctx.serverEndpoints,
        storage: ctx.storage,
        refs: ctx.stores.refs,
        embeds: ctx.embeds,
        emit: (window, value) => provider.emit("event", value, window),
      }),
    ))

  // Every other call names a binding, and bindings exist only after a register loaded the pane.
  const existing = () => loaded.pane ?? Promise.reject(new Error("browser.pane.unavailable"))

  const provider = ctx.provide(BrowserPane, {
    register: async (input, caller) => (await load()).register(caller.window, input.binding, input),
    load: async (input, caller) => (await existing()).load(caller.window, input.binding, input.tabID),
    command: async (input, caller) => (await existing()).command(caller.window, input.binding, input.command),
    inspect: async (input, caller) =>
      (await existing()).inspect(caller.window, input.binding, input.tabID, input.enabled),
    highlight: async (input, caller) =>
      (await existing()).highlight(caller.window, input.binding, input.tabID, input.ref),
    zoom: async (input, caller) => (await existing()).zoom(caller.window, input.binding, input.tabID, input.zoom),
    site: async (input, caller) => (await existing()).site(caller.window, input.binding, input.tabID),
    clearSite: async (input, caller) => (await existing()).clearSite(caller.window, input.binding, input.tabID),
    previewed: async (input, caller) =>
      (await existing()).previewed(caller.window, input.binding, input.requestID, input.opened, input.reason),
    handoff: async (input, caller) =>
      (await existing()).handoff(caller.window, input.binding, input.requestID, input.done),
    close: async (input, caller) => (await existing()).close(caller.window, input.binding),
  })

  // The host withdraws the Ipc before this runs, so windows hear nothing; they suspend on the Ipc going away.
  ctx.scope.addFinalizer(async () => {
    if (loaded.pane) await (await loaded.pane).dispose()
  })
}

export default setup
