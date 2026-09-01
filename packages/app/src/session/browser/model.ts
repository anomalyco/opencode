import { createEffect, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import type { BrowserPaneCommand, BrowserPaneRegistration, BrowserPaneState } from "@/runtime/platform/browser-pane"
import { usePlatform } from "@/runtime/platform/platform"
import { useServer } from "@/runtime/server/current"
import { useSettings } from "@/settings/model"
import { useLayout } from "@/shell/state/layout"
import type { SessionModel } from "../model"

export function createSessionBrowser(session: SessionModel) {
  const platform = usePlatform()
  const settings = useSettings()
  const language = useLanguage()
  const server = useServer()
  const layout = useLayout()
  const [state, setState] = createStore({
    opened: false,
    registration: undefined as BrowserPaneRegistration | undefined,
    browser: null as BrowserPaneState,
    error: undefined as string | undefined,
  })
  const available = createMemo(
    () =>
      !!platform.browserPane &&
      settings.ready() &&
      settings.general.experimentalBrowser() &&
      session.isDesktop() &&
      !!session.identity.sessionID() &&
      !server.health?.incompatible,
  )
  const open = () => {
    session.layout.view().reviewPanel.close()
    layout.fileTree.close()
    setState("opened", true)
  }

  createEffect(() => {
    const sessionID = session.identity.sessionID()
    const pane = platform.browserPane
    setState({ opened: false, registration: undefined, browser: null, error: undefined })
    if (!available() || !sessionID || !pane) return
    const owner = session.ownership.capture()
    const target = { sessionID, endpoint: server.conn.http }
    let registration: BrowserPaneRegistration | undefined
    const register = () => {
      if (registration) return
      registration = pane.register(target, (event) =>
        owner.run(() => (event.type === "open" ? open() : setState({ browser: event.state, error: event.error }))),
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
      registration?.close()
    })
  })

  createEffect(() => {
    if (state.opened && (session.layout.view().reviewPanel.opened() || layout.fileTree.opened())) {
      setState("opened", false)
    }
  })

  return {
    available,
    opened: () => state.opened,
    state: () => state.browser,
    error: () => state.error,
    registration: () => (state.opened ? state.registration : undefined),
    close: () => setState("opened", false),
    toggle: () => (state.opened ? setState("opened", false) : open()),
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
