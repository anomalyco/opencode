import { createEffect, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import type { BrowserPaneCommand, BrowserPaneRegistration, BrowserPaneState } from "@/runtime/platform/browser-pane"
import { usePlatform } from "@/runtime/platform/platform"
import { useServer } from "@/runtime/server/current"
import { useSettings } from "@/settings/model"
import type { SessionModel } from "../model"
import { SESSION_BROWSER_TAB } from "../helpers"

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
  const opened = () => state.registration !== undefined && session.layout.tabs().all().includes(SESSION_BROWSER_TAB)
  const open = () => {
    session.layout.view().reviewPanel.open()
    void session.layout.tabs().open(SESSION_BROWSER_TAB)
    session.layout.tabs().setActive(SESSION_BROWSER_TAB)
  }

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
          if (event.type === "open") return open()
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
          setState({ browser: event.state, error: event.error })
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
    error: () => state.error,
    registration: () => state.registration,
    close: () => session.layout.tabs().close(SESSION_BROWSER_TAB),
    open,
    command(command: BrowserPaneCommand) {
      setState("error", undefined)
      const owner = session.ownership.capture()
      void state.registration?.command(command).catch((error: unknown) => {
        if (!owner.current()) return
        setState("error", error instanceof Error ? error.message : language.t("common.requestFailed"))
      })
    },
  }
}
