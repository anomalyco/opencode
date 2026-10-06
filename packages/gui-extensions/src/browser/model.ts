import { batch, createRoot, createSignal, getOwner, onCleanup } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import type { Browser } from "@opencode/plugin-browser/rpc"
import { createKeyed, type Link, type SessionRef, type SetupContext } from "../sdk"
import { readHref } from "./comment"
import {
  createConnection,
  unavailable,
  type Connection,
  type InspectEvent,
  type Registration,
  type Zoom,
} from "./connection"
import { recordable, remember, withIcon } from "./history"
import type definition from "./index"
import { isHtml, resolveLink, workspaceFileURL } from "./link"
import { BrowserPane, type PaneEvent } from "./ipc"

type Session = Pick<SessionRef, "key">

/** What panels read. `registration` numbers each registration so a new one is observable. */
type Attachment = {
  registration?: number
  browser: Browser.State | null
  embeds: Readonly<Record<string, string>>
  suspended: boolean
  error?: string
}

type Live = {
  ref: SessionRef
  connection: Connection
  registration?: Registration
  revision: number
  /** Strip writes waiting for the session's location, without which the strip cannot be written. */
  held: { mirror?: () => void; focus?: Browser.TabID }
  /** The agent's previews waiting for the session's screen, which resolves their paths. */
  previews: string[]
  dispose: () => void
}

type ModelState = {
  attachments: Record<string, Attachment | undefined>
  /** Servers whose plugin lacks the browser RPC; sessions on them stop retrying. */
  unsupported: Record<string, true | undefined>
  errors: Record<string, string | undefined>
  /** Each session's page icons and zoom by tab, as this desktop reports them. */
  pages: Record<string, Record<string, PageDetail | undefined> | undefined>
}

/** A page's icon as a data URL, and its zoom factor, 1 at 100%. */
type PageDetail = { icon?: string; zoom: number }

/** A mounted pane; the newest one answers the reload and inspect commands. */
type PaneHandle = {
  visible: () => boolean
  address: () => string
  reload: () => void
  inspectable: () => boolean
  /** Turns the element picker on or off. */
  inspect: () => void
  /** Focuses the address field and selects its text. */
  focusAddress: () => void
}

export type Model = ReturnType<typeof createModel>

// Attachments belong to the shell session tab, not the session route: native pages and the agent's
// browser survive visiting Settings or another tab and close when the session tab does.
export function createModel(ctx: SetupContext<typeof definition>) {
  const sessions = ctx.sessions
  const layout = ctx.layout
  const links = ctx.links
  // The extension's own main entry provides the pane. `uses` declares it by reference; its full token, which this chunk
  // loads with the protocol schemas, resolves it.
  const pane = ctx.uses.pane.load(BrowserPane)

  const client = () => {
    const current = pane()

    return current.status === "active" ? current.value : undefined
  }

  const owner = getOwner()
  const history = ctx.stores.history
  const [state, setState] = createStore<ModelState>({ attachments: {}, unsupported: {}, errors: {}, pages: {} })
  const [panes, setPanes] = createSignal<readonly PaneHandle[]>([])
  const live = new Map<string, Live>()
  const listeners = new Map<string, (event: PaneEvent) => void>()
  const inspectors = new Map<string, Set<(event: InspectEvent) => void>>()
  const addressed = new Map<string, Set<(tabID: Browser.TabID) => void>>()
  // Sessions where the user just opened a tab; its pane focuses the address field once the blank page shows.
  const opening = new Set<string>()
  // Each tab's last recorded page, so a state that repeats it does not write the history again.
  const recorded = new Map<string, string>()
  const key = (tabID: string) => `${ctx.id}:${tabID}`

  // Pages the user or the agent opened, once loaded: only a tab whose page exists has a real URL and title, as a
  // restored tab's saved URL carries no title until it loads again.
  const record = (session: string, next: { browser: Browser.State | null; embeds: Readonly<Record<string, string>> }) =>
    next.browser?.tabs.forEach((tab) => {
      if (tab.loading || tab.loadError || !next.embeds[tab.id] || !recordable(tab.url)) return
      const page = `${tab.url}\n${tab.title}`

      if (recorded.get(`${session}\n${tab.id}`) === page) return
      recorded.set(`${session}\n${tab.id}`, page)
      history.set({
        visits: remember(
          history.value.visits,
          { url: tab.url, title: tab.title },
          state.pages[session]?.[tab.id]?.icon,
        ),
      })
    })

  // The SDK removes the listener when the Ipc's generation ends.
  createKeyed(pane, (current) => current.on("event", (value) => listeners.get(value.binding)?.(value.event)))

  const wakeCurrent = () => {
    if (document.visibilityState !== "visible") return
    const view = sessions.current()

    if (view) live.get(view.key)?.connection.wake()
  }

  // The pane's Ipc goes away while its main extension reloads or is disabled, taking every binding with it.
  // Each attachment keeps its tabs and registers again once the Ipc is back. Created before the first attachment,
  // so its first run finds nothing to refresh or wake.
  createKeyed(
    pane,
    () => {
      live.forEach((entry) => entry.connection.refresh())
      wakeCurrent()
    },
    { otherwise: () => live.forEach((entry) => entry.connection.refresh()) },
  )

  const close = (id: string) => {
    live.get(id)?.dispose()
    live.delete(id)
    opening.delete(id)
    Array.from(recorded.keys())
      .filter((item) => item.startsWith(`${id}\n`))
      .forEach((item) => recorded.delete(item))
    batch(() => {
      setState("attachments", id, undefined)
      setState("pages", id, undefined)
    })
  }

  const attach = (ref: SessionRef) => {
    const id = ref.key

    if (live.has(id) || state.unsupported[ref.server.id] || !ref.server.compatible) return

    const entry: Live = {
      ref,
      revision: 0,
      held: {},
      previews: [],
      dispose: () => undefined,
      connection: createConnection({
        client,
        listen(binding, listener) {
          listeners.set(binding, listener)

          return () => {
            listeners.delete(binding)
          }
        },
        target: () => ({ server: ref.server.id, session: ref.id }),
        // Focus requests write to the owning session's panel even while another shell tab is routed,
        // so the side panel and browser tab are already selected when the user returns to it.
        focus: (tabID) => {
          if (!ref.location) {
            entry.held.focus = tabID

            return
          }

          layout.open(key(tabID), ref, { tab: "select" })
        },
        preview: (path) => preview(entry, path),
        inspect: (event) => inspectors.get(id)?.forEach((listener) => listener(event)),
        page: (event) => {
          setState("pages", id, (pages) => ({
            ...pages,
            [event.tabID]: event.icon ? { icon: event.icon, zoom: event.zoom } : { zoom: event.zoom },
          }))
          const url = tab({ key: id }, event.tabID)?.url
          const visits = url && event.icon ? withIcon(history.value.visits, url, event.icon) : undefined

          if (visits) history.set({ visits })
        },
        address: (tabID) => addressed.get(id)?.forEach((listener) => listener(tabID)),
        change: (next, mirror) => {
          if (next.error === "browser.pane.unsupported") {
            setState("unsupported", ref.server.id, true)

            return close(id)
          }

          if (next.registration !== entry.registration) {
            entry.registration = next.registration

            if (next.registration) entry.revision++
          }

          batch(() => {
            setState(
              "attachments",
              id,
              reconcile({
                registration: next.registration ? entry.revision : undefined,
                browser: next.browser,
                embeds: next.embeds,
                suspended: next.suspended,
                error:
                  next.error === "browser.pane.replaced"
                    ? ctx.t("replaced")
                    : next.error
                      ? ctx.t("common.requestFailed")
                      : undefined,
              }),
            )
            record(id, next)

            // After the store: closing a strip tab asks this model whether the desktop still has it.
            if (ref.location) return mirror()
            entry.held.mirror = mirror
          })
        },
        strip: {
          stored: () => layout.stored(ref),
          open(tabID) {
            if (layout.state(key(tabID), ref) === "closed") layout.open(key(tabID), ref, { tab: "append" })
          },
          close: (tabID) => layout.close(key(tabID), ref),
        },
      }),
    }

    live.set(id, entry)
    setState("attachments", id, { browser: null, embeds: {}, suspended: false })

    // The attachment's own root, not the route effect that happened to call attach(), so `entry.dispose` ends it.
    const unwatch = createRoot((dispose) => {
      // A new session appears in the UI before its server-side creation finishes. The listeners follow the server's
      // live data: a re-authenticated server gets a new controller under the same ref.
      createKeyed(
        () => ref.server.data,
        (data) => {
          onCleanup(
            data.on("session.created", (event) => {
              if (event.data.sessionID === ref.id) entry.connection.wake()
            }),
          )
          onCleanup(
            data.on("session.execution.started", (event) => {
              if (event.data.sessionID === ref.id) entry.connection.wake()
            }),
          )
        },
      )

      // Mirrors the desktop's inventory and focus requests into the strip: writes held while the session's location
      // was unknown land once the server reports it.
      createKeyed(
        () => ref.location,
        () =>
          batch(() => {
            const held = entry.held
            entry.held = {}
            held.mirror?.()

            if (held.focus) layout.open(key(held.focus), ref, { tab: "select" })
          }),
      )

      // Previews made while another session was on screen open once the user returns to this one.
      createKeyed(
        () => sessions.current()?.key === ref.key && ctx.screen.current(),
        () => entry.previews.splice(0).forEach((path) => preview(entry, path)),
      )

      return dispose
    }, owner)

    if (!ref.pending) entry.connection.wake()
    entry.dispose = () => {
      unwatch()
      entry.connection.dispose()
    }
  }

  // The routed session attaches, once its server is compatible.
  createKeyed(() => {
    const view = sessions.current()

    if (!view?.id) return
    const ref = sessions.list().find((item) => item.key === view.key)

    return ref?.server.compatible ? ref : undefined
  }, attach)

  // An attachment closes with its shell tab, or when its server stops being compatible. The store's keys mirror `live`,
  // and reading them follows new attachments.
  createKeyed(
    () => {
      const owned = new Set(sessions.list().map((ref) => ref.key))

      const stale = Object.keys(state.attachments).filter((id) => {
        const entry = live.get(id)

        return !!entry && !(owned.has(id) && entry.ref.server.compatible)
      })

      return stale.length > 0 ? stale : undefined
    },
    (stale) => stale.forEach(close),
  )
  onCleanup(() => Array.from(live.keys()).forEach(close))

  // These are edges, not a reactive dependency on suspended state: eviction while the window
  // remains focused must not immediately reopen the browser and defeat resource cleanup.
  createKeyed(() => sessions.current()?.key, wakeCurrent)
  makeEventListener(window, "focus", wakeCurrent)
  makeEventListener(document, "visibilitychange", wakeCurrent)
  makeEventListener(document, "pointerdown", wakeCurrent)
  makeEventListener(document, "keydown", wakeCurrent)

  const attachment = (session: Session) => state.attachments[session.key]

  const attached = (session: Session) => {
    const value = attachment(session)

    return value?.registration !== undefined || !!value?.browser
  }

  // The desktop has not answered with its first inventory yet: the routed session is about to attach, or it registered
  // and waits.
  const pending = (session: SessionRef) => {
    const value = attachment(session)

    if (!value) return !state.unsupported[session.server.id] && session.server.compatible && !session.pending

    return value.registration !== undefined && !value.browser && !value.error
  }

  const available = (session: SessionRef) =>
    !state.unsupported[session.server.id] && !!session.id && session.server.compatible && !layout.narrow()

  const tab = (session: Session, tabID: string) => attachment(session)?.browser?.tabs.find((item) => item.id === tabID)

  const command = (session: Session, action: Browser.Action) => {
    const id = session.key
    batch(() => {
      setState("errors", id, undefined)

      if (state.attachments[id]) setState("attachments", id, "error", undefined)
    })

    // An unreachable pane is suspended, not a failed request.
    const failed = (cause: unknown) => {
      if (!unavailable(cause)) setState("errors", id, ctx.t("common.requestFailed"))
    }

    const connection = live.get(id)?.connection

    if (!connection) return failed(new Error("browser.pane.unavailable"))
    void connection.command(action).catch(failed)
  }

  const openURL = (session: Session, url: string) => command(session, { type: "tabs.open", url })

  // Only the routed session has a file model to resolve workspace paths with: the session screen's.
  const files = (session: Session) => {
    const screen = ctx.screen.current()

    return screen && sessions.current()?.key === session.key ? screen.file : undefined
  }

  // The desktop's own sidecar shares this disk, and its browser pane accepts file:// URLs inside the
  // session workspace only. Forwarded loopback servers do not qualify, matching the desktop policy.
  const canOpen = (session: SessionRef, path?: string) => {
    if (!session.server.builtin || !available(session) || !attached(session)) return false

    if (path === undefined) return true
    const current = files(session)

    return !!current && !current.absolute(path)
  }

  const openFile = (session: Session, path: string) => {
    const current = files(session)

    if (current) openURL(session, workspaceFileURL(current, path))
  }

  // HTML the pane can load opens as a browser tab. Palette results and comment chips name files to
  // edit, so they keep opening file tabs.
  const target = (link: Link) => {
    if (link.exact || link.origin || !link.session) return
    const view = sessions.current()

    if (view?.key !== link.session.key) return
    const current = files(view)

    if (!current) return
    const path = resolveLink(current, link.href, link.base)

    if (!path || !isHtml(path) || !canOpen(view, path)) return

    return { view, path }
  }

  // The agent's browser.preview tool: the link router picks the browser for HTML, the file panel otherwise. Only the
  // session's screen resolves workspace paths, so a preview for a session that is not on screen waits for it.
  const preview = (entry: Live, path: string) => {
    const view = sessions.current()

    if (view?.key === entry.ref.key && ctx.screen.current()) {
      links.open({ href: path, session: view, background: true })

      return
    }

    if (!entry.previews.includes(path)) entry.previews.push(path)
  }

  return {
    available,
    attached,
    canOpen,
    openFile,
    openURL,
    command,
    tab,
    /** Opens a blank tab for the user, whose pane then focuses the address field. */
    open(session: SessionRef) {
      if (!available(session)) return
      opening.add(session.key)
      command(session, { type: "tabs.open" })
    },
    /** Whether the user just opened a tab in this session; true once, for the pane that focuses its address. */
    opened: (session: Session) => opening.delete(session.key),
    /** A page's icon and zoom, once this desktop reported them. */
    page: (session: Session, tabID: string) => state.pages[session.key]?.[tabID],
    zoom(session: Session, tabID: Browser.TabID, zoom: Zoom) {
      live.get(session.key)?.connection.zoom(tabID, zoom)
    },
    /** The page's cookie count; undefined while the pane cannot answer. */
    site: (session: Session, tabID: Browser.TabID) => live.get(session.key)?.connection.site(tabID),
    /** Deletes the page's cookies and stored data, and reloads it. */
    clearSite: (session: Session, tabID: Browser.TabID) => live.get(session.key)?.connection.clearSite(tabID),
    /** Pages the browser showed, newest first. */
    visits: () => history.value.visits,
    clearHistory: () => {
      recorded.clear()
      history.set({ visits: [] })
    },
    /** The page asking for the address field with its shortcut. */
    onAddress(session: Session, listener: (tabID: Browser.TabID) => void) {
      const set = addressed.get(session.key) ?? new Set()
      set.add(listener)
      addressed.set(session.key, set)

      return () => {
        set.delete(listener)

        if (!set.size) addressed.delete(session.key)
      }
    },
    pending,
    /**
     * Tab IDs to list in the side panel: the desktop's inventory, limited to tabs stored in the strip. Until the first
     * inventory arrives, the stored tabs, so a restored selection holds; that inventory then prunes the ones it lacks.
     */
    tabs(session: SessionRef, open: readonly string[]) {
      if (pending(session)) return open

      if (!attached(session)) return []

      return attachment(session)?.browser?.tabs.flatMap((item) => (open.includes(item.id) ? [item.id] : [])) ?? []
    },
    error: (session: Session) => state.errors[session.key] ?? attachment(session)?.error,
    suspended: (session: Session) => attachment(session)?.suspended ?? false,
    /** The host embed of a tab's page, once main created the page. */
    embed: (session: Session, tabID: string) => attachment(session)?.embeds[tabID],
    /**
     * Creates a restored tab's page, which then reports its embed. Holds for the caller's scope: a new registration,
     * e.g. after a suspension, has no page for the tab and loads it again.
     */
    load(session: Session, tabID: Browser.TabID) {
      createKeyed(
        () => attachment(session)?.registration,
        () => live.get(session.key)?.registration?.load(tabID),
      )
    },
    closeTab(session: Session, tabID: string) {
      const item = tab(session, tabID)

      if (item) command(session, { type: "tabs.close", tabID: item.id })
    },
    focusTab(session: Session, tabID: string) {
      const item = tab(session, tabID)

      if (item && item.id !== attachment(session)?.browser?.focusedTabID)
        command(session, { type: "tabs.focus", tabID: item.id })
    },
    match: (link: Link) => !!target(link),
    openLink(link: Link) {
      const found = target(link)

      if (found) openFile(found.view, found.path)
    },
    /** The page's element picker starting, stopping, or picking an element. */
    onInspect(session: Session, listener: (event: InspectEvent) => void) {
      const set = inspectors.get(session.key) ?? new Set()
      set.add(listener)
      inspectors.set(session.key, set)

      return () => {
        set.delete(listener)

        if (!set.size) inspectors.delete(session.key)
      }
    },
    inspect(session: Session, tabID: Browser.TabID, enabled: boolean) {
      live.get(session.key)?.connection.inspect(tabID, enabled)
    },
    /** Flashes a picked element, or clears any highlight when ref is omitted. */
    highlight(session: Session, tabID: Browser.TabID, ref?: Browser.Ref) {
      live.get(session.key)?.connection.highlight(tabID, ref)
    },
    /** Shows the browser tab a comment names and flashes its element while the page still has it. */
    reveal(session: SessionRef, href: string) {
      const target = readHref(href)
      const item = target && tab(session, target.tabID)

      if (!item) return
      layout.open(key(item.id), session, { tab: "select" })

      if (target.ref) live.get(session.key)?.connection.highlight(item.id, target.ref)
    },
    pane: () => panes()[0],
    mount(handle: PaneHandle) {
      setPanes((list) => [handle, ...list])

      return () => setPanes((list) => list.filter((item) => item !== handle))
    },
  }
}
