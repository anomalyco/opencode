import { batch, createEffect, createMemo, getOwner, onCleanup, runWithOwner } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import type { Browser } from "@opencode-ai/plugin-browser/rpc"
import { useLanguage } from "@/runtime/i18n/language"
import type { BrowserPaneCommand, BrowserPaneRegistration, BrowserPaneState } from "@/runtime/platform/browser-pane"
import { usePlatform } from "@/runtime/platform/platform"
import type { useServer } from "@/runtime/server/current"
import { useSettings } from "@/settings/model"
import { findSessionTab, tabKey, useTabs } from "@/shell/tabs/tabs"

type Server = ReturnType<typeof useServer>

export type BrowserAttachment = {
  registration?: BrowserPaneRegistration
  browser: BrowserPaneState
  error?: string
}

type Live = {
  server: Server
  sessionID: string
  /** Shell tab that owns this attachment once seen; it may route to a child session later. */
  tab?: string
  registration?: BrowserPaneRegistration
  retry?: ReturnType<typeof setTimeout>
  attempts: number
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
    const owner = getOwner()
    const [store, setStore] = createStore<Record<string, BrowserAttachment | undefined>>({})
    // Servers whose plugin lacks the browser RPC; sessions on them stop retrying.
    const [unsupported, setUnsupported] = createStore<Record<string, true | undefined>>({})
    const live = new Map<string, Live>()
    const focus = new Map<string, Set<(tabID: Browser.TabID) => void>>()
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

    return {
      enabled,
      supported: (server: Server) => !unsupported[server.key],
      state: (server: Server, sessionID: string) => store[key(server, sessionID)],
      attach(server: Server, sessionID: string) {
        const id = key(server, sessionID)
        if (live.has(id)) return
        const pane = platform.browserPane
        if (!pane || !enabled() || unsupported[server.key] || server.health?.incompatible) return
        const entry: Live = { server, sessionID, attempts: 0, dispose: () => undefined }
        live.set(id, entry)
        setStore(id, { browser: null })
        const register = () => {
          if (entry.registration || live.get(id) !== entry) return
          // The server's shared transport follows a restarted sidecar's port whether or not any route
          // for this session is mounted; the connection captured at attach time may predate it.
          const endpoint = { ...server.conn.http, url: server.ctx.sdk.url }
          const registration = pane.register({ sessionID, endpoint }, (event) => {
            if (live.get(id) !== entry) return
            if (event.type === "focus") return focus.get(id)?.forEach((listener) => listener(event.tabID))
            if (event.error === "browser.pane.unsupported") {
              setUnsupported(server.key, true)
              return close(id)
            }
            if (event.error === "browser.pane.replaced") {
              registration.close()
              entry.registration = undefined
              return setStore(id, {
                registration: undefined,
                browser: null,
                error: language.t("session.browser.replaced"),
              })
            }
            // The desktop dropped the attachment (server restart, attach race). Re-register so the
            // agent's browser tool comes back without a reload.
            if (event.error === "browser.pane.registration.closed") {
              registration.close()
              entry.registration = undefined
              setStore(id, { registration: undefined, browser: null, error: undefined })
              entry.retry = setTimeout(register, Math.min(30_000, 1_000 * 2 ** entry.attempts++))
              return
            }
            if (event.state) entry.attempts = 0
            batch(() => {
              setStore(id, "browser", reconcile(event.state))
              setStore(id, "error", event.error ? language.t("common.requestFailed") : undefined)
            })
          })
          entry.registration = registration
          setStore(id, { registration, browser: null, error: undefined })
        }
        // A new session appears in the UI before its server-side creation finishes. The listener
        // belongs to this provider, not to the route effect that happened to call attach().
        const data = server.ctx.data
        const unsubscribe = runWithOwner(owner, () =>
          data.on("session.created", (event) => {
            if (event.data.sessionID === sessionID) register()
          }),
        )
        if (!data.session.creating(sessionID)) register()
        entry.dispose = () => {
          unsubscribe?.()
          clearTimeout(entry.retry)
          entry.registration?.close()
        }
      },
      /** Desktop focus requests for a mounted session route; nothing is replayed to routes mounted later. */
      onFocus(server: Server, sessionID: string, listener: (tabID: Browser.TabID) => void) {
        const id = key(server, sessionID)
        const listeners = focus.get(id) ?? new Set()
        listeners.add(listener)
        focus.set(id, listeners)
        return () => {
          listeners.delete(listener)
          if (!listeners.size) focus.delete(id)
        }
      },
      command(server: Server, sessionID: string, command: BrowserPaneCommand) {
        const registration = live.get(key(server, sessionID))?.registration
        if (!registration) return Promise.reject(new Error("browser.pane.unavailable"))
        return registration.command(command)
      },
    }
  },
})
