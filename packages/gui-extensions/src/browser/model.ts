import { batch, createEffect, createSignal, getOwner, on, onCleanup, runWithOwner, untrack } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import type { Browser } from "@opencode/plugin-browser/rpc"
import { Layout, Links, Sessions, type Context, type Link, type SessionRef } from "../sdk"
import { readHref } from "./comment"
import { createConnection, unavailable, type Connection, type InspectEvent, type Registration } from "./connection"
import { isHtml, resolveLink, workspaceFileURL } from "./link"
import { BrowserPane, type PaneEvent } from "./remote"

type Session = Pick<SessionRef, "key">

/** What panels read. `registration` numbers each registration so a new one is observable. */
type Attachment = {
  registration?: number
  browser: Browser.State | null
  surfaces: Readonly<Record<string, string>>
  suspended: boolean
  error?: string
}

type Live = {
  ref: SessionRef
  connection: Connection
  registration?: Registration
  revision: number
  dispose: () => void
}

/** A mounted pane; the newest one answers the reload and inspect commands. */
type PaneHandle = {
  visible: () => boolean
  address: () => string
  reload: () => void
  inspectable: () => boolean
  /** Turns the element picker on or off. */
  inspect: () => void
}

export type Model = ReturnType<typeof createModel>

// Attachments belong to the shell session tab, not the session route: native pages and the agent's
// browser survive visiting Settings or another tab and close when the session tab does.
export function createModel(ctx: Context) {
  const sessions = ctx.use(Sessions)
  const layout = ctx.use(Layout)
  const links = ctx.use(Links)
  const client = ctx.use(BrowserPane)
  const owner = getOwner()
  const [state, setState] = createStore({
    attachments: {} as Record<string, Attachment | undefined>,
    // Servers whose plugin lacks the browser RPC; sessions on them stop retrying.
    unsupported: {} as Record<string, true | undefined>,
    errors: {} as Record<string, string | undefined>,
  })
  const [panes, setPanes] = createSignal<readonly PaneHandle[]>([])
  const live = new Map<string, Live>()
  const listeners = new Map<string, (event: PaneEvent) => void>()
  const inspectors = new Map<string, Set<(event: InspectEvent) => void>>()
  const key = (tabID: string) => `${ctx.id}:${tabID}`

  createEffect(() => {
    const current = client()
    if (!current) return
    onCleanup(current.on("event", (value) => listeners.get(value.binding)?.(value.event)))
  })

  const close = (id: string) => {
    live.get(id)?.dispose()
    live.delete(id)
    setState("attachments", id, undefined)
  }

  const attach = (ref: SessionRef) => {
    const id = ref.key
    if (live.has(id) || state.unsupported[ref.server.id] || !ref.server.compatible) return
    const entry: Live = {
      ref,
      revision: 0,
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
        focus: (tabID) => layout.open(key(tabID), ref, { select: true }),
        preview: (path) => preview(ref, path),
        inspect: (event) => inspectors.get(id)?.forEach((listener) => listener(event)),
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
                surfaces: next.surfaces,
                suspended: next.suspended,
                error:
                  next.error === "browser.pane.replaced"
                    ? ctx.t("replaced")
                    : next.error
                      ? ctx.t("common.requestFailed")
                      : undefined,
              }),
            )
            // After the store: closing a strip tab asks this model whether the desktop still has it.
            mirror()
          })
        },
        strip: {
          stored: () => layout.stored(ref),
          open(tabID) {
            if (layout.state(key(tabID), ref) === "closed") layout.open(key(tabID), ref, { focus: false })
          },
          close: (tabID) => layout.close(key(tabID), ref),
        },
      }),
    }
    live.set(id, entry)
    setState("attachments", id, { browser: null, surfaces: {}, suspended: false })
    // A new session appears in the UI before its server-side creation finishes. The listener
    // belongs to this model, not to the route effect that happened to call attach().
    const data = ref.server.data
    const unsubscribe = runWithOwner(owner, () => [
      data.on("session.created", (event) => {
        if (event.data.sessionID === ref.id) entry.connection.wake()
      }),
      data.on("session.execution.started", (event) => {
        if (event.data.sessionID === ref.id) entry.connection.wake()
      }),
    ])
    if (!ref.pending) entry.connection.wake()
    entry.dispose = () => {
      unsubscribe?.forEach((dispose) => dispose())
      entry.connection.dispose()
    }
  }

  createEffect(() => {
    const view = sessions.current()
    if (!view?.id) return
    const ref = sessions.list().find((item) => item.key === view.key)
    if (ref) untrack(() => attach(ref))
  })

  createEffect(() => {
    const owned = new Set(sessions.list().map((ref) => ref.key))
    // The store's keys mirror `live`, and reading them keeps this effect subscribed to new attachments.
    Object.keys(state.attachments).forEach((id) => {
      const entry = live.get(id)
      if (!entry) return
      if (owned.has(id) && entry.ref.server.compatible) return
      close(id)
    })
  })
  onCleanup(() => Array.from(live.keys()).forEach(close))

  const wakeCurrent = () => {
    if (document.visibilityState !== "visible") return
    const view = sessions.current()
    if (view) live.get(view.key)?.connection.wake()
  }
  // These are edges, not a reactive dependency on suspended state: eviction while the window
  // remains focused must not immediately reopen the browser and defeat resource cleanup.
  createEffect(on(() => sessions.current()?.key, wakeCurrent))
  // The pane's remote goes away while its main extension reloads or is disabled, taking every binding with it.
  // Each attachment keeps its tabs and registers again once the remote is back.
  createEffect(
    on(
      () => !!client(),
      (available) => {
        live.forEach((entry) => entry.connection.refresh())
        if (available) wakeCurrent()
      },
      { defer: true },
    ),
  )
  makeEventListener(window, "focus", wakeCurrent)
  makeEventListener(document, "visibilitychange", wakeCurrent)
  makeEventListener(document, "pointerdown", wakeCurrent)
  makeEventListener(document, "keydown", wakeCurrent)

  const attachment = (session: Session) => state.attachments[session.key]
  const attached = (session: Session) => {
    const value = attachment(session)
    return value?.registration !== undefined || !!value?.browser
  }
  const available = (session: SessionRef) =>
    !state.unsupported[session.server.id] && !!session.id && session.server.compatible && !layout.narrow()
  const tab = (session: Session, tabID: string) => attachment(session)?.browser?.tabs.find((item) => item.id === tabID)

  const command = (session: Session, action: Browser.Action) => {
    const id = session.key
    setState("errors", id, undefined)
    // An unreachable pane is suspended, not a failed request.
    const failed = (error: unknown) => {
      if (!unavailable(error)) setState("errors", id, ctx.t("common.requestFailed"))
    }
    const connection = live.get(id)?.connection
    if (!connection) return failed(new Error("browser.pane.unavailable"))
    void connection.command(action).catch(failed)
  }
  const openURL = (session: Session, url: string) => command(session, { type: "tabs.open", url })

  // Only the routed session has a file model to resolve workspace paths with.
  const files = (session: Session) => {
    const view = sessions.current()
    return view?.key === session.key ? view.file : undefined
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
    const path = resolveLink(view.file, link.href, link.base)
    if (!path || !isHtml(path) || !canOpen(view, path)) return
    return { view, path }
  }

  // The agent's browser.preview tool: the link router picks the browser for HTML, the file panel otherwise.
  const preview = (ref: SessionRef, path: string) => {
    const view = sessions.current()
    if (view?.key === ref.key) links.open({ href: path, session: view, background: true })
  }

  return {
    available,
    attached,
    canOpen,
    openFile,
    openURL,
    command,
    tab,
    open(session: SessionRef) {
      if (available(session)) command(session, { type: "tabs.open" })
    },
    /** Tab IDs to list in the side panel: the desktop's inventory, limited to tabs stored in the strip. */
    tabs(session: Session, open: readonly string[]) {
      if (!attached(session)) return []
      return attachment(session)?.browser?.tabs.flatMap((item) => (open.includes(item.id) ? [item.id] : [])) ?? []
    },
    error: (session: Session) => state.errors[session.key] ?? attachment(session)?.error,
    suspended: (session: Session) => attachment(session)?.suspended ?? false,
    /** The host surface of a tab's page, once main created the page. */
    surface: (session: Session, tabID: string) => attachment(session)?.surfaces[tabID],
    load(session: Session, tabID: Browser.TabID) {
      if (attachment(session)?.registration === undefined) return
      live.get(session.key)?.registration?.load(tabID)
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
      layout.open(key(item.id), session, { select: true })
      if (target.ref) live.get(session.key)?.connection.highlight(item.id, target.ref)
    },
    pane: () => panes()[0],
    mount(handle: PaneHandle) {
      setPanes((list) => [handle, ...list])
      return () => setPanes((list) => list.filter((item) => item !== handle))
    },
  }
}
