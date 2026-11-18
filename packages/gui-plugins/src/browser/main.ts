import { builtinMainContext } from "@opencode/plugin/gui/builtin"
import { MenubarItem, type Plugin } from "@opencode/plugin/gui/main"
import type { Pane } from "./pane"
import type { Profile } from "./profile"
import { RefsStore } from "./refs"
import { viewportToolbarAvailable } from "./viewport-toolbar-machine"
import { BrowserPane } from "./ipc"
import { BrowserProfile } from "./profile/ipc"
import { BrowserSites, createSitePermissions } from "./site-permissions"
import { createSystemMedia } from "./system-media"
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
  // The permission decisions the user kept for sites; "Sign out everywhere" keeps them, as they are settings.
  const sites = createSitePermissions(ctx.storage, () => sitesIpc.changed())
  // The desktop's one browser profile, created the first time a pane or the settings page needs it. A failed creation
  // is forgotten, so the next request tries again.
  const loaded: LoadedProfile = {}

  const profile = () => {
    if (ctx.signal.aborted) return Promise.reject(new Error("browser.pane.unavailable"))

    if (loaded.profile) return loaded.profile

    const pending = import("./profile")
      .then((module) =>
        module.createBrowserProfile({
          notificationTitle: (name) => ctx.t("extensions.notification.title", { name }),
          signal: ctx.signal,
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
                  t: ctx.t,
                  serverEndpoints: ctx.serverEndpoints,
                  storage: builtinMainContext(ctx).storage,
                  refs,
                  embeds: ctx.embeds,
                  profile: value,
                  sites,
                  // Development builds log each system call for the camera and microphone, so a tester can see that
                  // the system is asked only after a click on Allow.
                  system: createSystemMedia(ctx.app.packaged ? undefined : (line) => ctx.log.write("info", line)),
                  toolbar: viewportToolbarAvailable(ctx.app.channel),
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

  if (process.platform === "darwin") {
    const reload = (window?: number) => {
      const current = selectPane(paneState)

      return current.kind === "ready" ? current.pane.menuReload(window) : undefined
    }

    ctx.add(MenubarItem, {
      menu: "view",
      id: "hardReload",
      after: "view.reload",
      get label() {
        return ctx.t("menu.hardReload")
      },
      enabled: () => !!reload(ctx.windows.focused()?.id),
      run: (window) => reload(window?.id)?.(),
    })
  }

  const provider = ctx.provide(BrowserPane, {
    register: async (input, caller) => (await load()).register(caller.window, input.binding, input),
    load: async (input, caller) => (await pane()).load(caller.window, input.binding, input.tabID),
    command: async (input, caller) => (await pane()).command(caller.window, input.binding, input.command),
    createTab: async (input, caller) => (await pane()).createTab(caller.window, input.binding, input.owner, input.url),
    closeTab: async (input, caller) => (await pane()).closeTab(caller.window, input.binding, input.owner, input.id),
    find: async (input, caller) => (await pane()).find(caller.window, input.binding, input.tabID, input.action),
    notice: async (input, caller) => (await pane()).notice(caller.window, input.binding, input.tabID, input.token, input.dismiss, input.copy),
    reviewLink: async (input, caller) => (await pane()).reviewLink(caller.window, input.binding, input.url),
    answer: async (input, caller) =>
      (await pane()).answer(caller.window, input.binding, input.tabID, input.id, input.answer),
    inspect: async (input, caller) => (await pane()).inspect(caller.window, input.binding, input.tabID, input.enabled),
    highlight: async (input, caller) => (await pane()).highlight(caller.window, input.binding, input.tabID, input.ref),
    zoom: async (input, caller) => (await pane()).zoom(caller.window, input.binding, input.tabID, input.zoom),
    setViewport: async (input, caller) =>
      (await pane()).setViewport(caller.window, input.binding, input.tabID, input.viewport),
    site: async (input, caller) => (await pane()).site(caller.window, input.binding, input.tabID),
    clearSite: async (input, caller) => (await pane()).clearSite(caller.window, input.binding, input.tabID),
    clearCache: async (input, caller) => (await pane()).clearCache(caller.window, input.binding, input.tabID, input.address),
    reveal: async (input, caller) => (await pane()).reveal(caller.window, input.binding, input.tabID),
    openPage: async (input, caller) => (await pane()).openPage(caller.window, input.binding, input.tabID, input.expected),
    close: async (input, caller) => (await pane()).close(caller.window, input.binding),
    forget: async (input) => (await load()).forget(input.server,input.session),
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
    sites: async (input) => (await profile()).sites(input.source, input.profile),
    importBrowser: (input) =>
      serial(async () => (await profile()).importBrowser(input.source, input.profile, input.sites)),
    importFile: (input) => serial(async () => (await profile()).importFile(input.path)),
    summary: async () => (await profile()).summary(),
    clear: () => serial(async () => (await profile()).clear()),
    browserExtensions: async (input) => (await profile()).browserExtensions(input.source, input.profile),
    install: (input) => serial(async () => (await profile()).install(input)),
    remove: (input) => serial(async () => (await profile()).remove(input.id)),
    click: async (input, caller) => {
      const win = ctx.windows.get(caller.window)

      if (!win || win.isDestroyed()) return false
      // The window lays out in CSS pixels; its content is in device-independent ones. Each edge is rounded by itself,
      // as the page view's edges are, so the popup's edges land on the same pixels as the button's and the page's.
      const zoom = win.webContents.getZoomFactor()
      const anchor = input.anchor
      const current = await profile()
      const tab = (await pane()).toolbarTab(caller.window, input.binding, input.tabID)

      if (tab === undefined) return false
      const x = Math.round(anchor.x * zoom)
      const y = Math.round(anchor.y * zoom)

      return current.clickExtension(win, input.id, tab.id, {
        anchor: {
          x,
          y,
          width: Math.round((anchor.x + anchor.width) * zoom) - x,
          height: Math.round((anchor.y + anchor.height) * zoom) - y,
        },
        top: Math.round(input.pageTop * zoom),
        pageTop: tab.pageTop,
        rtl: input.rtl,
      })
    },
    enable: (input) => serial(async () => (await profile()).enable(input.id, input.enabled)),
  })

  const sitesIpc = ctx.provide(BrowserSites, {
    state: () => ({ decisions: sites.list() }),
    set: async (input) => sites.set(input),
    remove: async (input) => sites.remove(input),
  })

  // The host withdraws the Ipc before this runs, so windows hear nothing; they suspend on the Ipc going away.
  // The profile holds the session's preloads and extensions. One still loading is awaited and disposed
  // here, so the next instance of this plugin never starts beside it, and it never tears down the next one's.
  ctx.onCleanup(async () => {
    dispatch({ type: "disposed" })
    await disposing
    const value = loaded.value ?? (await loaded.profile?.catch(() => undefined))
    value?.dispose()
  })
}

export default setup
