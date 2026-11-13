import { builtinMainContext } from "@opencode/plugin/gui/builtin"
import type { Plugin } from "@opencode/plugin/gui/main"
import type { Pane } from "./pane"
import type { Profile } from "./profile"
import { RefsStore } from "./refs"
import { BrowserPane } from "./ipc"
import { BrowserProfile } from "./profile/ipc"
import {
  createMainPaneState,
  isLoadingPaneAttempt,
  selectPane,
  transitionMainPane,
  type MainPaneEvent,
} from "./main-machine"

/** The profile's creation while it runs, and the profile once it is created. */
type LoadedProfile = { profile?: Promise<Profile>; value?: Profile }

const setup: Plugin.MainSetup = (ctx) => {
  let paneState = createMainPaneState<Pane>()
  const loads = new Map<number, ReturnType<typeof Promise.withResolvers<Pane>>>()
  let disposing: Promise<void> | undefined
  const refs = ctx.storage.store("refs", RefsStore)
  // The desktop's one browser profile, created the first time a pane or the settings page needs it. A failed creation
  // is forgotten, so the next request tries again.
  const loaded: LoadedProfile = {}

  const profile = () => {
    if (ctx.signal.aborted) return Promise.reject(new Error("browser.pane.unavailable"))

    if (loaded.profile) return loaded.profile

    const pending = import("./profile")
      .then((module) =>
        module.createBrowserProfile({
          storage: ctx.storage,
          log: ctx.log,
          changed: () => profiles.changed(),
          cookiesChanged: () => profiles.emit("cookies", {}),
        }),
      )
      .then((value) => {
        // Cleanup that started while it loaded awaits it and disposes it.
        if (ctx.signal.aborted) return value
        loaded.value = value
        profiles.changed()

        return value
      })

    loaded.profile = pending
    // Logged and forgotten once per creation, not once per caller.
    pending.catch((cause: unknown) => {
      ctx.log.write("warn", "browser profile failed to load", { cause: String(cause) })

      if (loaded.profile === pending) loaded.profile = undefined
    })

    return pending
  }

  const dispatch = (event: MainPaneEvent<Pane>) => {
    const next = transitionMainPane(paneState, event)
    paneState = next.state
    next.effects.forEach((effect) => {
      switch (effect.type) {
        case "load-pane":
          loads.set(effect.attempt, Promise.withResolvers())
          // The pane brings the CDP driver and the full RPC client with every protocol schema;
          // load it when a window first registers a pane instead of at startup.
          void Promise.all([import("./pane"), profile()])
            .then(([module, value]) => {
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
                  profile: value,
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
    reveal: async (input, caller) => (await pane()).reveal(caller.window, input.binding, input.tabID),
    close: async (input, caller) => (await pane()).close(caller.window, input.binding),
  })

  // Jobs that write the profile run one after another, whichever window or surface started them: each surface runs
  // one at a time, but the settings page, the Add extension dialog and every pane's offer are separate surfaces.
  const writes = { last: Promise.resolve() }

  const serial = <T>(run: () => Promise<T>) => {
    const next = writes.last.then(run)
    writes.last = next.then(
      () => undefined,
      () => undefined,
    )

    return next
  }

  // Until a pane or the settings page loads the profile, windows list no extensions; loading pushes the real list.
  const profiles = ctx.provide(BrowserProfile, {
    state: () => ({ extensions: loaded.value?.extensions() ?? [], remoteSignIns: loaded.value?.remoteSignIns() }),
    shareSignIns: async (input) => (await profile()).shareSignIns(input.enabled),
    sources: async () => (await profile()).sources(),
    importBrowser: (input) => serial(async () => (await profile()).importBrowser(input.source, input.profile)),
    importFile: (input) => serial(async () => (await profile()).importFile(input.path)),
    summary: async () => (await profile()).summary(),
    clear: () => serial(async () => (await profile()).clear()),
    browserExtensions: async (input) => (await profile()).browserExtensions(input.source, input.profile),
    install: (input) => serial(async () => (await profile()).install(input)),
    remove: (input) => serial(async () => (await profile()).remove(input.id)),
    click: async (input, caller) => {
      const win = ctx.windows.get(caller.window)

      if (!win || win.isDestroyed()) return false
      // The window lays out in CSS pixels; its content is in device-independent ones.
      const zoom = win.webContents.getZoomFactor()
      const anchor = input.anchor

      return (await profile()).clickExtension(win, input.id, {
        x: Math.round(anchor.x * zoom),
        y: Math.round(anchor.y * zoom),
        width: Math.round(anchor.width * zoom),
        height: Math.round(anchor.height * zoom),
      })
    },
    enable: (input) => serial(async () => (await profile()).enable(input.id, input.enabled)),
  })

  // The host withdraws the Ipc before this runs, so windows hear nothing; they suspend on the Ipc going away.
  // The profile holds the session's preloads, extensions and file guard. One still loading is awaited and disposed
  // here, so the next instance of this plugin never starts beside it, and it never tears down the next one's.
  ctx.onCleanup(async () => {
    dispatch({ type: "disposed" })
    await disposing
    const value = loaded.value ?? (await loaded.profile?.catch(() => undefined))
    value?.dispose()
  })
}

export default setup
