import { batch, createEffect, createMemo, on, onCleanup } from "solid-js"
import type { Browser } from "@opencode-ai/schema/browser"
import { createStore, reconcile } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import type { BrowserPaneCommand, BrowserPaneRegistration, BrowserPaneState } from "@/runtime/platform/browser-pane"
import { usePlatform } from "@/runtime/platform/platform"
import { useServer } from "@/runtime/server/current"
import { useSettings } from "@/settings/model"
import type { SessionModel } from "../model"
import { isSessionBrowserTab, sessionBrowserTab } from "../helpers"

export function createSessionBrowser(session: SessionModel) {
  const platform = usePlatform()
  const settings = useSettings()
  const language = useLanguage()
  const server = useServer()
  const [state, setState] = createStore({
    registration: undefined as BrowserPaneRegistration | undefined,
    browser: null as BrowserPaneState,
    error: undefined as string | undefined,
    // The connected server has no browser plugin.
    unsupported: false,
  })
  const available = createMemo(
    () =>
      !!platform.browserPane &&
      settings.ready() &&
      settings.general.experimentalBrowser() &&
      session.isDesktop() &&
      !!session.identity.sessionID() &&
      !server.health?.incompatible &&
      !state.unsupported,
  )
  const browserTabs = createMemo(
    () => state.browser?.tabs.filter((tab) => session.layout.tabs().all().includes(sessionBrowserTab(tab.id))) ?? [],
  )
  const opened = () => state.registration !== undefined && browserTabs().length > 0
  const focus = (tabID: Browser.TabID) => {
    session.layout.view().reviewPanel.open()
    const tabs = session.layout.tabs()
    const key = sessionBrowserTab(tabID)
    if (!tabs.all().includes(key)) tabs.setAll([...tabs.all(), key])
    tabs.setActive(key)
  }
  const command = (command: BrowserPaneCommand) => {
    setState("error", undefined)
    const owner = session.ownership.capture()
    void state.registration?.command(command).catch(() => {
      if (owner.current()) setState("error", language.t("common.requestFailed"))
    })
  }
  createEffect(
    on(
      () => session.layout.tabs().active(),
      (active) => {
        const tab = state.browser?.tabs.find((tab) => sessionBrowserTab(tab.id) === active)
        if (tab && tab.id !== state.browser?.focusedTabID) command({ type: "tabs.focus", tabID: tab.id })
      },
    ),
  )
  createEffect(
    on(
      () => session.layout.tabs().all(),
      (current, previous) => {
        previous
          ?.filter((key) => isSessionBrowserTab(key) && !current.includes(key))
          .forEach((key) => {
            const tab = state.browser?.tabs.find((tab) => sessionBrowserTab(tab.id) === key)
            if (tab) command({ type: "tabs.close", tabID: tab.id })
          })
      },
    ),
  )

  createEffect(() => {
    const sessionID = session.identity.sessionID()
    const pane = platform.browserPane
    setState({ registration: undefined, browser: null, error: undefined })
    if (!available() || !sessionID || !pane) return
    const owner = session.ownership.capture()
    const target = { sessionID, endpoint: server.conn.http }
    let registration: BrowserPaneRegistration | undefined
    let retry: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    const register = () => {
      if (registration) return
      registration = pane.register(target, (event) =>
        owner.run(() => {
          if (event.type === "focus") return focus(event.tabID)
          if (event.error === "browser.pane.unsupported") return setState("unsupported", true)
          // The desktop dropped the attachment (server restart, attach race).
          // Re-register so the agent's browser tool comes back without a reload.
          if (event.error === "browser.pane.registration.closed") {
            registration?.close()
            registration = undefined
            setState({ registration: undefined, browser: null, error: undefined })
            retry = setTimeout(register, Math.min(30_000, 1_000 * 2 ** attempts++))
            return
          }
          if (event.state) attempts = 0
          batch(() => {
            const known = new Set(state.browser?.tabs.map((tab) => sessionBrowserTab(tab.id)) ?? [])
            setState("browser", reconcile(event.state))
            setState("error", event.error ? language.t("common.requestFailed") : undefined)
            const tabs = session.layout.tabs()
            const ids = event.state?.tabs.map((tab) => sessionBrowserTab(tab.id)) ?? []
            tabs
              .all()
              .filter((key) => isSessionBrowserTab(key) && !ids.includes(key))
              .forEach(tabs.close)
            const current = tabs.all()
            const added = ids.filter((key) => !known.has(key) && !current.includes(key))
            if (added.length) tabs.setAll([...current, ...added])
          })
        }),
      )
      setState({ registration, browser: null, error: undefined })
    }
    // A new session appears in the UI before its server-side creation finishes.
    const unsubscribe = session.shared.data.on("session.created", (event) => {
      if (event.data.sessionID === sessionID) register()
    })
    if (!session.shared.data.session.creating(sessionID)) register()
    onCleanup(() => {
      unsubscribe()
      clearTimeout(retry)
      registration?.close()
    })
  })

  return {
    available,
    opened,
    state: () => state.browser,
    tabs: browserTabs,
    active: () =>
      browserTabs().find((tab) => sessionBrowserTab(tab.id) === session.layout.tabs().active()) ??
      browserTabs().find((tab) => tab.id === state.browser?.focusedTabID) ??
      browserTabs()[0],
    error: () => state.error,
    registration: () => state.registration,
    close: (tabID: Browser.TabID) => session.layout.tabs().close(sessionBrowserTab(tabID)),
    open: () => command({ type: "tabs.open" }),
    command,
  }
}
