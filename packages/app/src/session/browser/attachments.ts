import { batch, createEffect, createMemo, createRoot, getOwner, on, onCleanup, runWithOwner } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { createSimpleContext } from "@opencode/ui/context"
import { useLanguage } from "@/runtime/i18n/language"
import type { BrowserPaneCommand } from "@/runtime/platform/browser-pane"
import { usePlatform } from "@/runtime/platform/platform"
import type { useServer } from "@/runtime/server/current"
import type { SessionStateKey } from "@/runtime/server/scope"
import { useSettings } from "@/settings/model"
import { findSessionTab, tabKey, useTabs } from "@/shell/tabs/tabs"
import { useCurrentRoute, useLayout } from "@/shell/state/layout"
import { sessionBrowserTab } from "@/shell/state/session-tabs"
import { createEventListener } from "@solid-primitives/event-listener"
import { createBrowserConnection, type BrowserConnectionState } from "./connection"

type Server = ReturnType<typeof useServer>

export type BrowserAttachment = BrowserConnectionState

type Live = {
  server: Server
  sessionID: string
  /** Shell tab that owns this attachment once seen; it may route to a child session later. */
  tab?: string
  connection: ReturnType<typeof createBrowserConnection>
  dispose: () => void
}

// Attachments belong to the shell session tab, not the session route: native pages and the agent's
// browser survive visiting Settings or another tab and close when the session tab or the setting does.
export const { use: useBrowserAttachments, provider: BrowserAttachmentsProvider } = createSimpleContext({
  name: "BrowserAttachments",
  gate: false,
  init: () => {
    const platform = usePlatform()
    const settings = useSettings()
    const language = useLanguage()
    const shellTabs = useTabs()
    const layout = useLayout()
    const route = useCurrentRoute()
    const owner = getOwner()
    const [store, setStore] = createStore<Record<string, BrowserAttachment | undefined>>({})
    // Servers whose plugin lacks the browser RPC; sessions on them stop retrying.
    const [unsupported, setUnsupported] = createStore<Record<string, true | undefined>>({})
    const live = new Map<string, Live>()
    const preview = new Map<string, Set<(path: string) => void>>()
    const key = (server: Server, sessionID: string) => `${server.key}\n${sessionID}`
    const enabled = createMemo(
      () => !!platform.browserPane && settings.ready() && settings.general.experimentalBrowser(),
    )
    const close = (id: string) => {
      live.get(id)?.dispose()
      live.delete(id)
      setStore(id, undefined)
    }
    createEffect(() => {
      const on = enabled()
      const tabs = shellTabs.store
      // The store's keys mirror `live`, and reading them keeps this effect subscribed to new attachments.
      Object.keys(store).forEach((id) => {
        const entry = live.get(id)
        if (!entry) return
        // Tabs hydrate asynchronously, so the owner is learned when first seen rather than required up
        // front. A tab keeps owning the attachment while it exists, even after routing back to its parent.
        const current = findSessionTab(tabs, entry.server.key, entry.sessionID)
        if (current) entry.tab = tabKey(current)
        const owned = entry.tab === undefined || tabs.some((tab) => tabKey(tab) === entry.tab)
        if (on && owned && !entry.server.health?.incompatible) return
        close(id)
      })
    })
    onCleanup(() => Array.from(live.keys()).forEach(close))

    const wakeCurrent = () => {
      if (document.visibilityState !== "visible") return
      const current = route()
      if (current.type !== "session") return
      live.get(`${current.server}\n${current.sessionId}`)?.connection.wake()
    }
    // These are edges, not a reactive dependency on suspended state: eviction while the window
    // remains focused must not immediately reopen the browser and defeat resource cleanup.
    createEffect(on(route, wakeCurrent))
    createEventListener(window, "focus", wakeCurrent)
    createEventListener(document, "visibilitychange", wakeCurrent)
    createEventListener(document, "pointerdown", wakeCurrent)
    createEventListener(document, "keydown", wakeCurrent)

    return {
      enabled,
      supported: (server: Server) => !unsupported[server.key],
      state: (server: Server, sessionID: string) => store[key(server, sessionID)],
      attach(server: Server, sessionID: string, sessionKey: SessionStateKey) {
        const id = key(server, sessionID)
        if (live.has(id)) return
        const pane = platform.browserPane
        if (!pane || !enabled() || unsupported[server.key] || server.health?.incompatible) return
        // Focus requests write to the owning session's layout even while another shell tab is routed,
        // so the Review pane and browser tab are already selected when the user returns to it.
        const tabs = createRoot((dispose) => ({ dispose, layout: layout.tabs(sessionKey) }), owner)
        const connection = createBrowserConnection({
          pane,
          // Resolve the current port at every wake, including after sidecar replacement.
          target: () => ({
            serverKey: server.key,
            sessionID,
            endpoint: { ...server.conn.http, url: server.ctx.sdk.url },
          }),
          focus: (tabID) => {
            const tab = sessionBrowserTab(tabID)
            batch(() => {
              shellTabs.setPane(findSessionTab(shellTabs.store, server.key, sessionID), "review", true)
              if (!tabs.layout.all().includes(tab)) tabs.layout.setAll([...tabs.layout.all(), tab])
              tabs.layout.setActive(tab)
            })
          },
          preview: (path) => preview.get(id)?.forEach((listener) => listener(path)),
          change: (state) => {
            if (state.error === "browser.pane.unsupported") {
              setUnsupported(server.key, true)
              return close(id)
            }
            setStore(
              id,
              reconcile({
                ...state,
                error:
                  state.error === "browser.pane.replaced"
                    ? language.t("session.browser.replaced")
                    : state.error
                      ? language.t("common.requestFailed")
                      : undefined,
              }),
            )
          },
        })
        const entry: Live = { server, sessionID, connection, dispose: () => undefined }
        live.set(id, entry)
        setStore(id, { browser: null, suspended: false })
        // A new session appears in the UI before its server-side creation finishes. The listener
        // belongs to this provider, not to the route effect that happened to call attach().
        const data = server.ctx.data
        const unsubscribe = runWithOwner(owner, () => [
          data.on("session.created", (event) => {
            if (event.data.sessionID === sessionID) connection.wake()
          }),
          data.on("session.execution.started", (event) => {
            if (event.data.sessionID === sessionID) connection.wake()
          }),
        ])
        if (!data.session.creating(sessionID)) connection.wake()
        entry.dispose = () => {
          unsubscribe?.forEach((dispose) => dispose())
          connection.dispose()
          tabs.dispose()
        }
      },
      /** Agent requests to show a file in this session's Review pane. */
      onPreview(server: Server, sessionID: string, listener: (path: string) => void) {
        const id = key(server, sessionID)
        const listeners = preview.get(id) ?? new Set()
        listeners.add(listener)
        preview.set(id, listeners)
        return () => {
          listeners.delete(listener)
          if (!listeners.size) preview.delete(id)
        }
      },
      command(server: Server, sessionID: string, command: BrowserPaneCommand) {
        const connection = live.get(key(server, sessionID))?.connection
        if (!connection) return Promise.reject(new Error("browser.pane.unavailable"))
        return connection.command(command)
      },
    }
  },
})
