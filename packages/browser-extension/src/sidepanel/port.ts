// The panel's bridge to the background service worker: one long-lived port, mirrored into a store.
// Chrome may stop and restart an MV3 worker at any time. The panel keeps its own state and, on every
// reconnect, re-announces its window and the session it shows so the worker can re-derive its state.
import { createMemo, createSignal, onCleanup } from "solid-js"
import { showToast } from "@opencode/ui/toast"
import { createStore, reconcile } from "solid-js/store"
import {
  PANEL_PORT,
  type AccessRequest,
  type TabRequest,
  type ActiveTab,
  type BrowserState,
  type RelayState,
  type ServiceState,
  type ToBackground,
  type ToPanel,
} from "../shared/protocol"
import type { SiteScriptApproval, SiteScriptsState } from "../shared/site-script"
import { toastError } from "./format"

type View = Extract<ToBackground, { type: "session.show" | "session.hide" }>

const reconnectDelay = 300

export type Background = ReturnType<typeof createBackground>

export function createBackground() {
  const [state, setState] = createStore<{
    service: ServiceState
    browser?: BrowserState
    activeTab: ActiveTab | null
    scripts: SiteScriptsState
    /** Agent install requests waiting for the user, oldest first. */
    approvals: SiteScriptApproval[]
    /** Sessions asking to read browsing data, oldest first. */
    access: AccessRequest[]
    /** Conversations asking the user to share a tab, oldest first. */
    tabRequests: TabRequest[]
    /** The Browser Control relay connection and the tabs its sessions use. */
    browserControl: RelayState
  }>({
    service: { status: "loading" },
    activeTab: null,
    // Assume allowed until the worker says otherwise, so the setup notice does not flash on open.
    scripts: { available: true, scripts: [] },
    approvals: [],
    access: [],
    tabRequests: [],
    browserControl: { status: "offline", tabs: [] },
  })
  // The file the agent last asked to show; cleared when the panel shows another session.
  const [preview, setPreview] = createSignal<Extract<ToPanel, { type: "preview" }>>()
  const windowID = chrome.windows.getCurrent().then((window) => window.id ?? chrome.windows.WINDOW_ID_CURRENT)
  let view: View = { type: "session.hide" }
  let disposed = false
  let port: chrome.runtime.Port | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const post = (message: ToBackground) => {
    // A port can disconnect between its onDisconnect check and this call; the reconnect re-sends state.
    try {
      port?.postMessage(message)
    } catch {
      port = undefined
    }
  }

  const connect = async () => {
    const id = await windowID
    if (disposed) return
    const next = chrome.runtime.connect({ name: PANEL_PORT })
    port = next
    next.onMessage.addListener((message: ToPanel) => {
      if (message.type === "service") return setState("service", message.state)
      if (message.type === "browser") return setState("browser", message.state)
      if (message.type === "error") return toastError("OpenCode Browser")(message.message)
      if (message.type === "notice") return showToast({ variant: "success", description: message.message })
      if (message.type === "scripts") return setState("scripts", reconcile(message.state))
      if (message.type === "approvals") return setState("approvals", message.approvals)
      if (message.type === "access") return setState("access", message.requests)
      if (message.type === "tabRequests") return setState("tabRequests", message.requests)
      if (message.type === "preview") return setPreview(message)
      if (message.type === "browserControl") return setState("browserControl", reconcile(message.state))
      if (message.type === "activeTab") setState("activeTab", message.tab)
    })
    next.onDisconnect.addListener(() => {
      // Reading lastError marks it handled; a worker restart is expected, not an error.
      void chrome.runtime.lastError
      if (port === next) port = undefined
      if (disposed) return
      clearTimeout(timer)
      timer = setTimeout(() => void connect(), reconnectDelay)
    })
    post({ type: "panel.hello", windowID: id })
    post(view)
  }

  void connect()
  onCleanup(() => {
    disposed = true
    clearTimeout(timer)
    port?.disconnect()
  })

  // Keep the last ready service while the worker restarts, so a transient `loading` does not tear down
  // the open connection and its data.
  const service = createMemo<Extract<ServiceState, { status: "ready" }>["info"] | undefined>((previous) => {
    if (state.service.status === "ready") return state.service.info
    if (state.service.status === "loading") return previous
    return undefined
  })

  return {
    state,
    service,
    /** Browser state for one session; the worker only reports the session this panel shows. */
    browser(sessionID: string | undefined) {
      if (!sessionID || state.browser?.sessionID !== sessionID) return
      return state.browser
    },
    preview,
    closePreview() {
      setPreview(undefined)
    },
    show(input: { sessionID: string; directory: string }) {
      if (preview()?.sessionID !== input.sessionID) setPreview(undefined)
      view = { type: "session.show", sessionID: input.sessionID, directory: input.directory }
      post(view)
    },
    hide() {
      if (view.type === "session.hide") return
      setPreview(undefined)
      view = { type: "session.hide" }
      post(view)
    },
    send(message: Exclude<ToBackground, View | { type: "panel.hello" }>) {
      post(message)
    },
  }
}
