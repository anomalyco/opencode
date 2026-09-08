import type { Context, SessionContext } from "@opencode/plugin/desktop"
import { batch, createEffect, getOwner, runWithOwner } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { Browser } from "@opencode/plugin-browser/rpc"
import { BrowserDesktop } from "./rpc"

type State = { browser: Browser.State | null; surfaces: Readonly<Record<string, string>>; error?: string }
type Live = {
  session: SessionContext
  bindingID: string
  attempts: number
  retry?: ReturnType<typeof setTimeout>
  dispose(): void
}

export function createBrowser(ctx: Context, enabled: () => boolean) {
  const rpc = ctx.main.rpc(BrowserDesktop.Definition)
  const [states, setState] = createStore<Record<string, State | undefined>>({})
  const [unsupported, setUnsupported] = createStore<Record<string, boolean>>({})
  const live = new Map<string, Live>()
  const owner = getOwner()
  const close = (key: string) => {
    live.get(key)?.dispose()
    live.delete(key)
    setState(key, undefined)
  }
  const available = (session: SessionContext) =>
    enabled() && session.server.compatible && !unsupported[session.server.id]
  const command = (session: SessionContext, action: Browser.Action) => {
    const entry = live.get(session.key)
    if (!entry) return
    void rpc.command({ bindingID: entry.bindingID, action }).catch(() => {
      if (live.get(session.key) === entry) setState(session.key, "error", ctx.i18n.t("common.requestFailed"))
    })
  }
  ctx.lifecycle.own(
    rpc.events.on("changed", ({ bindingID, event }) => {
      const entry = Array.from(live.values()).find((entry) => entry.bindingID === bindingID)
      if (!entry) return
      const session = entry.session
      if (event.type === "focus") {
        ctx.ui.panel.open(event.tabID, session)
        return
      }
      if (event.error === "browser.pane.unsupported") {
        setUnsupported(session.server.id, true)
        close(session.key)
        return
      }
      if (event.error === "browser.pane.replaced") {
        entry.dispose()
        setState(session.key, { browser: null, surfaces: {}, error: ctx.i18n.t("session.browser.replaced") })
        return
      }
      batch(() => {
        setState(session.key, "browser", reconcile(event.state))
        setState(session.key, "surfaces", reconcile(event.surfaces))
        setState(session.key, "error", event.error ? ctx.i18n.t("common.requestFailed") : undefined)
      })
      if (event.state) entry.attempts = 0
      if (event.error === "browser.pane.registration.closed") {
        clearTimeout(entry.retry)
        entry.retry = setTimeout(() => register(entry), Math.min(30_000, 1_000 * 2 ** entry.attempts++))
      }
    }),
  )
  const register = (entry: Live) => {
    if (live.get(entry.session.key) !== entry) return
    // The host resolves the current endpoint and credentials on every attempt.
    void rpc
      .register({ bindingID: entry.bindingID, sessionID: entry.session.sessionID, serverID: entry.session.server.id })
      .catch(() => {})
  }
  createEffect(() => {
    const sessions = ctx.sessions.list()
    Array.from(live).forEach(([key, entry]) => {
      if (!sessions.some((session) => session.key === key) || !available(entry.session)) close(key)
    })
    sessions.filter(available).forEach((session) => {
      if (live.has(session.key)) return
      const entry: Live = { session, bindingID: crypto.randomUUID(), attempts: 0, dispose: () => {} }
      live.set(session.key, entry)
      setState(session.key, { browser: null, surfaces: {} })
      const stop = runWithOwner(owner, () =>
        session.server.data.on("session.created", (event) => {
          if (event.data.sessionID === session.sessionID) register(entry)
        }),
      )
      entry.dispose = () => {
        stop?.()
        clearTimeout(entry.retry)
        void rpc.close({ bindingID: entry.bindingID }).catch(() => {})
      }
      if (!session.creating) register(entry)
    })
  })
  ctx.lifecycle.own(() => Array.from(live.keys()).forEach(close))
  return {
    available,
    state: (session: SessionContext) => states[session.key],
    tabs: (session: SessionContext) => states[session.key]?.browser?.tabs ?? [],
    command,
    open: (session: SessionContext) => command(session, { type: "tabs.open" }),
    close: (session: SessionContext, tabID: Browser.TabID) => command(session, { type: "tabs.close", tabID }),
    focus(session: SessionContext, tabID: Browser.TabID) {
      if (states[session.key]?.browser?.focusedTabID !== tabID) command(session, { type: "tabs.focus", tabID })
    },
  }
}
