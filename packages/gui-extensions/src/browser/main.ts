import { MainApp, MainStorage, Surfaces, Windows, type Setup } from "../sdk/main"
import type { Pane } from "./pane"
import { BrowserPane } from "./remote"

const setup: Setup = (ctx) => {
  const windows = ctx.use(Windows)
  const app = ctx.use(MainApp)
  const storage = ctx.use(MainStorage)
  const surfaces = ctx.use(Surfaces)
  const loaded: { pane?: Promise<Pane> } = {}
  // The pane brings the CDP driver and the full RPC client with every protocol schema;
  // load it when a window first registers a pane instead of at startup.
  const load = () =>
    (loaded.pane ??= import("./pane").then((module) =>
      module.createBrowserPane({
        windows,
        app,
        storage,
        surfaces,
        emit: (window, value) => provided.emit("event", value, window),
      }),
    ))
  // Every other call names a binding, and bindings exist only after a register loaded the pane.
  const existing = () => loaded.pane ?? Promise.reject(new Error("browser.pane.unavailable"))
  const provided = ctx.provide(BrowserPane, {
    register: async (input, caller) => (await load()).register(caller.window, input.binding, input),
    load: async (input, caller) => (await existing()).load(caller.window, input.binding, input.tabID),
    command: async (input, caller) => (await existing()).command(caller.window, input.binding, input.command),
    inspect: async (input, caller) =>
      (await existing()).inspect(caller.window, input.binding, input.tabID, input.enabled),
    highlight: async (input, caller) =>
      (await existing()).highlight(caller.window, input.binding, input.tabID, input.ref),
    close: async (input, caller) => (await existing()).close(caller.window, input.binding),
  })
  // The host withdraws the remote before this runs, so windows hear nothing; they suspend on the remote going away.
  ctx.cleanup(async () => {
    if (loaded.pane) await (await loaded.pane).dispose()
  })
}

export default setup
