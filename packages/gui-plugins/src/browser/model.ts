import { batch, createRoot, createSignal, getOwner, onCleanup, untrack } from "solid-js"
import { createStore, reconcile, unwrap } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import type { Browser } from "@opencode/plugin-browser/rpc"
import { createKeyed, type SessionRef, type SetupContext } from "@opencode/plugin/gui"
import { readHref } from "./comment"
import {
  openBinding,
  unavailable,
  type InspectEvent,
  type PageEvent,
  type Registration,
  type ShortcutEvent,
  type Zoom,
} from "./connection"
import { recordable, remember, withIcon } from "./history"
import type definition from "./index"
import { workspaceFileURL } from "./link"
import { BrowserPane, type PaneEvent } from "./ipc"
import {
  addressFocusTab,
  createInitialState,
  serverSupported,
  sessionAttached,
  sessionBrowser,
  sessionEmbed,
  sessionError,
  sessionPending,
  sessionRegistration,
  sessionSuspended,
  sessionTab,
  sessionTabs,
  transition,
  type Event,
  type Ipc,
  type MachineEffect,
  type State,
} from "./machine"

type Session = Pick<SessionRef, "key">

/** A session the machine attached: its ref, and the I/O its effects drive. */
type Drive = {
  ref: SessionRef
  /** The agent's previews waiting for the session's screen, which resolves their paths. */
  previews: string[]
  dispose: () => void
}

type ModelState = {
  machine: State
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
  /** Closes the selected browser tab, including a blank page. */
  close: () => void
  inspectable: () => boolean
  /** Turns the element picker on or off. */
  inspect: () => void
  /** Focuses the address field and selects its text. */
  focusAddress: () => void
  /** Runs a key press the page handed to the app, as if it was pressed in this pane. */
  press: (event: ShortcutEvent) => void
  /** Marks the pane as holding the user's focus, which the page took outside the window's document. */
  focused: () => void
}

export type Model = ReturnType<typeof createModel>

// Attachments belong to the shell session tab, not the session route: native pages and the agent's
// browser survive visiting Settings or another tab and close when the session tab does.
export function createModel(ctx: SetupContext<typeof definition>) {
  const sessions = ctx.sessions
  const layout = ctx.layout
  const links = ctx.links
  // The plugin's own main entry provides the pane. `uses` declares it by reference; its full token, which this chunk
  // loads with the protocol schemas, resolves it.
  const pane = ctx.use(BrowserPane)

  const client = () => {
    const current = pane()

    return current.status === "active" ? current.value : undefined
  }

  const ipc = (): Ipc => {
    const current = pane()

    return current.status === "active"
      ? { status: "active", generation: current.generation }
      : { status: current.status }
  }

  const owner = getOwner()
  const history = ctx.stores.history
  const [state, setState] = createStore<ModelState>({ machine: createInitialState(untrack(ipc)), pages: {} })
  const [panes, setPanes] = createSignal<readonly PaneHandle[]>([])
  // The I/O handles the machine's effects drive. They are never read as state.
  const drives = new Map<string, Drive>()
  const registrations = new Map<string, { attempt: number; registration: Registration }>()
  const registerTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const servers = new Map<string, () => void>()
  const listeners = new Map<string, (event: PaneEvent) => void>()
  const inspectors = new Map<string, Set<(event: InspectEvent) => void>>()
  // Each tab's last recorded page, so a state that repeats it does not write the history again.
  const recorded = new Map<string, string>()
  const key = (tabID: string) => `${ctx.id}:${tabID}`

  // Main names why it moved control elsewhere or refused an address; any other failure is a failed request.
  const describe = (error: string) => {
    if (error === "browser.pane.replaced") return ctx.t("replaced")

    if (error === "browser.address.credentials") return ctx.t("refused.credentials")

    if (error === "browser.address.workspace") return ctx.t("refused.workspace")

    if (error === "browser.address.web") return ctx.t("refused.web")

    return ctx.t("common.requestFailed")
  }

  const dispatch = (event: Event) => {
    // Reads from reactive computations, such as a pane's `opened`, must not subscribe them to every state change.
    const previous = untrack(() => unwrap(state.machine))
    const next = transition(previous, event)

    // The state lands before the effects: closing a strip tab asks this model whether the desktop still has it.
    if (next.state !== previous) setState("machine", reconcile(next.state))
    next.effects.forEach(run)
  }

  const run = (effect: MachineEffect) => {
    if (effect.type === "open-registration") return open(effect)

    if (effect.type === "close-registration") {
      const current = registrations.get(effect.sessionKey)

      if (current?.attempt !== effect.attempt) return
      registrations.delete(effect.sessionKey)
      current.registration.close()

      return
    }

    if (effect.type === "schedule-register-timeout")
      return schedule(registerTimers, effect.sessionKey, effect.delayMs, () =>
        dispatch({ type: "register.timed-out", sessionKey: effect.sessionKey, attempt: effect.attempt }),
      )

    if (effect.type === "cancel-register-timeout") return cancel(registerTimers, effect.sessionKey)

    if (effect.type === "schedule-retry")
      return schedule(retryTimers, effect.sessionKey, effect.delayMs, () =>
        dispatch({ type: "retry.due", sessionKey: effect.sessionKey, attempt: effect.attempt }),
      )

    if (effect.type === "cancel-retry") return cancel(retryTimers, effect.sessionKey)

    if (effect.type === "send-command") return send(effect)

    // Answers after the command's synchronous error reset, so a repeated rejection still counts as a new one.
    if (effect.type === "reject-command")
      return queueMicrotask(() =>
        dispatch({
          type: "command.failed",
          sessionKey: effect.sessionKey,
          attempt: undefined,
          request: effect.request,
          error: effect.error,
          unavailable: effect.unavailable,
        }),
      )

    if (effect.type === "sync-strip") return syncStrip(effect)

    if (effect.type === "focus-strip-tab") {
      const ref = drives.get(effect.sessionKey)?.ref

      if (ref) layout.open(key(effect.tabID), ref, { tab: "select" })

      return
    }

    if (effect.type === "record-history") return record(effect.sessionKey)

    if (effect.type === "detach") return detach(effect.sessionKey)

    if (effect.type === "watch-server") return watchServer(effect.serverID)
    servers.get(effect.serverID)?.()
    servers.delete(effect.serverID)
  }

  const schedule = (
    timers: Map<string, ReturnType<typeof setTimeout>>,
    sessionKey: string,
    delay: number,
    fire: () => void,
  ) => {
    cancel(timers, sessionKey)
    timers.set(
      sessionKey,
      setTimeout(() => {
        timers.delete(sessionKey)
        fire()
      }, delay),
    )
  }

  const cancel = (timers: Map<string, ReturnType<typeof setTimeout>>, sessionKey: string) => {
    clearTimeout(timers.get(sessionKey))
    timers.delete(sessionKey)
  }

  const open = (effect: Extract<MachineEffect, { type: "open-registration" }>) => {
    const sessionKey = effect.sessionKey
    const attempt = effect.attempt
    const drive = drives.get(sessionKey)
    const current = client()

    if (!drive) return

    if (!current) return dispatch({ type: "register.failed", sessionKey, attempt, unavailable: true, closed: false })
    registrations.get(sessionKey)?.registration.close()
    const target = { server: drive.ref.server.id, session: drive.ref.id }

    registrations.set(sessionKey, {
      attempt,
      registration: openBinding({
        client: current,
        listen(binding, listener) {
          listeners.set(binding, listener)

          return () => void listeners.delete(binding)
        },
        target: effect.restore ? { ...target, restore: effect.restore } : target,
        accepted: () => dispatch({ type: "register.accepted", sessionKey, attempt }),
        failed: (cause) =>
          dispatch({
            type: "register.failed",
            sessionKey,
            attempt,
            unavailable: unavailable(cause),
            closed: cause instanceof Error && cause.message === "browser.pane.registration.closed",
          }),
        listener: (event) => receive(drive, attempt, event),
      }),
    })
  }

  const receive = (drive: Drive, attempt: number, event: PaneEvent) => {
    const sessionKey = drive.ref.key

    if (event.type === "state")
      return dispatch({ type: "pane.state", sessionKey, attempt, state: event.state, error: event.error })

    if (event.type === "embed")
      return dispatch({ type: "pane.embed", sessionKey, attempt, tabID: event.tabID, embed: event.embed })

    if (event.type === "focus") return dispatch({ type: "pane.focus", sessionKey, attempt, tabID: event.tabID })

    if (event.type === "preview") return preview(drive, event.path)

    if (event.type === "inspect") return inspectors.get(sessionKey)?.forEach((listener) => listener(event))

    if (event.type === "page") return page(sessionKey, event)

    // Only the pane on screen holds the page that had focus.
    if (sessions.current()?.key !== sessionKey) return

    if (event.type === "shortcut") return panes()[0]?.press(event)
    panes()[0]?.focused()
  }

  const send = (effect: Extract<MachineEffect, { type: "send-command" }>) => {
    const sessionKey = effect.sessionKey
    const current = registrations.get(sessionKey)

    // The binding the command was meant for could not open: the pane's Ipc is gone.
    if (current?.attempt !== effect.attempt)
      return queueMicrotask(() =>
        dispatch({
          type: "command.failed",
          sessionKey,
          attempt: effect.attempt,
          request: effect.request,
          error: "browser.pane.unavailable",
          unavailable: true,
        }),
      )

    void current.registration.command(effect.action).then(
      () => dispatch({ type: "command.settled", sessionKey, request: effect.request }),
      (cause: unknown) =>
        dispatch({
          type: "command.failed",
          sessionKey,
          attempt: effect.attempt,
          request: effect.request,
          error: cause instanceof Error && cause.message ? cause.message : "browser.command.failed",
          unavailable: unavailable(cause),
        }),
    )
  }

  // Closes every stored tab a native inventory lacks, then adds the tabs it newly lists.
  const syncStrip = (effect: Extract<MachineEffect, { type: "sync-strip" }>) => {
    const ref = drives.get(effect.sessionKey)?.ref

    if (!ref) return
    const keep = effect.keep ? new Set<string>(effect.keep) : undefined

    batch(() => {
      if (keep)
        layout
          .stored(ref)
          .filter((tabID) => !keep.has(tabID))
          .forEach((tabID) => layout.close(key(tabID), ref))
      effect.open.forEach((tabID) => {
        if (layout.state(key(tabID), ref) === "closed") layout.open(key(tabID), ref, { tab: "append" })
      })
    })
  }

  // Pages the user or the agent opened, once loaded: only a tab whose page exists has a real URL and title, as a
  // restored tab's saved URL carries no title until it loads again. Only the desktop's own reports count: a restored
  // tab's embed arrives before its page loads, with the saved URL as if it had.
  const record = (sessionKey: string) => {
    const machine = state.machine
    const attachment = machine.status === "open" ? machine.sessions[sessionKey] : undefined

    attachment?.browser?.tabs.forEach((tab) => {
      if (tab.loading || tab.loadError || !attachment.embeds[tab.id] || !recordable(tab.url)) return
      const visit = `${tab.url}\n${tab.title}`

      if (recorded.get(`${sessionKey}\n${tab.id}`) === visit) return
      recorded.set(`${sessionKey}\n${tab.id}`, visit)
      history.set({
        visits: remember(
          history.value.visits,
          { url: tab.url, title: tab.title },
          state.pages[sessionKey]?.[tab.id]?.icon,
        ),
      })
    })
  }

  const page = (sessionKey: string, event: PageEvent) => {
    setState("pages", sessionKey, (pages) => ({
      ...pages,
      [event.tabID]: event.icon ? { icon: event.icon, zoom: event.zoom } : { zoom: event.zoom },
    }))
    const url = sessionTab(state.machine, sessionKey, event.tabID)?.url
    const visits = url && event.icon ? withIcon(history.value.visits, url, event.icon) : undefined

    if (visits) history.set({ visits })
  }

  const detach = (sessionKey: string) => {
    const drive = drives.get(sessionKey)
    drives.delete(sessionKey)
    drive?.dispose()
    Array.from(recorded.keys())
      .filter((item) => item.startsWith(`${sessionKey}\n`))
      .forEach((item) => recorded.delete(item))
    setState("pages", sessionKey, undefined)
  }

  // A server whose plugin lacked the browser RPC may have it once its event stream reconnects or a restarted server
  // replaces its controller. Leaving the list ends the watch too: its next session asks again.
  const watchServer = (serverID: string) => {
    servers.get(serverID)?.()
    const changed = () => queueMicrotask(() => dispatch({ type: "server.changed", serverID }))
    const find = () => sessions.list().find((ref) => ref.server.id === serverID)?.server
    const marked = untrack(find)?.data

    if (!marked) return changed()

    servers.set(
      serverID,
      createRoot((dispose) => {
        createKeyed(
          () => find()?.data,
          (data) => {
            if (data !== marked) return changed()
            onCleanup(data.on("server.connected", changed))
          },
          { otherwise: changed },
        )

        return dispose
      }, owner),
    )
  }

  // The SDK removes the listener when the Ipc's generation ends.
  createKeyed(pane, (current) => current.on("event", (value) => listeners.get(value.binding)?.(value.event)))

  const wakeCurrent = () => {
    if (document.visibilityState !== "visible") return
    const view = sessions.current()

    if (view) dispatch({ type: "session.wake", sessionKey: view.key })
  }

  // The pane's Ipc goes away while its main plugin reloads or is not active, taking every binding with it.
  createKeyed(
    pane,
    () => {
      dispatch({ type: "ipc.changed", ipc: untrack(ipc) })
      wakeCurrent()
    },
    { otherwise: () => dispatch({ type: "ipc.changed", ipc: untrack(ipc) }) },
  )

  const attach = (ref: SessionRef) => {
    const sessionKey = ref.key

    if (
      drives.has(sessionKey) ||
      !serverSupported(
        untrack(() => state.machine),
        ref.server.id,
      )
    )
      return
    const drive: Drive = { ref, previews: [], dispose: () => undefined }
    drives.set(sessionKey, drive)
    dispatch({ type: "session.attached", sessionKey, serverID: ref.server.id, located: !!ref.location })

    // The attachment's own root, not the route effect that happened to call attach(), so `detach` ends it.
    drive.dispose = createRoot((dispose) => {
      // A new session appears in the UI before its server-side creation finishes. The listeners follow the server's
      // live data: a re-authenticated server gets a new controller under the same ref.
      createKeyed(
        () => ref.server.data,
        (data) => {
          onCleanup(
            data.on("session.created", (event) => {
              if (event.data.sessionID === ref.id) dispatch({ type: "session.created", sessionKey })
            }),
          )
          onCleanup(
            data.on("session.execution.started", (event) => {
              if (event.data.sessionID === ref.id) dispatch({ type: "session.wake", sessionKey })
            }),
          )
        },
      )

      // The server finished creating the session.
      createKeyed(
        () => !ref.pending,
        () => dispatch({ type: "session.wake", sessionKey }),
      )

      // The strip can be written once the server reports the session's location.
      createKeyed(
        () => !!ref.location,
        () => dispatch({ type: "session.located", sessionKey, located: true }),
        { otherwise: () => dispatch({ type: "session.located", sessionKey, located: false }) },
      )

      // Previews made while another session was on screen open once the user returns to this one.
      createKeyed(
        () => sessions.current()?.key === sessionKey && ctx.screen.current(),
        () => drive.previews.splice(0).forEach((path) => preview(drive, path)),
      )

      return dispose
    }, owner)
  }

  // The routed session attaches, once its server is compatible and has the browser RPC.
  createKeyed(() => {
    const view = sessions.current()

    if (!view?.id) return
    const ref = sessions.list().find((item) => item.key === view.key)

    return ref?.server.compatible && serverSupported(state.machine, ref.server.id) ? ref : undefined
  }, attach)

  // An attachment closes with its shell tab, or when its server stops being compatible.
  createKeyed(
    () => {
      const machine = state.machine

      if (machine.status !== "open") return
      const owned = new Set(sessions.list().map((ref) => ref.key))

      const stale = Object.keys(machine.sessions).filter((id) => {
        const drive = drives.get(id)

        return !!drive && !(owned.has(id) && drive.ref.server.compatible)
      })

      return stale.length > 0 ? stale : undefined
    },
    (stale) => dispatch({ type: "session.removed", sessionKeys: stale }),
  )
  onCleanup(() => {
    dispatch({ type: "disposed" })
    recorded.clear()
  })

  // These are edges, not a reactive dependency on suspended state: eviction while the window
  // remains focused must not immediately reopen the browser and defeat resource cleanup.
  createKeyed(
    () => sessions.current()?.key,
    (sessionKey) => {
      dispatch({ type: "session.routed", sessionKey })
      wakeCurrent()
    },
    { otherwise: () => dispatch({ type: "session.routed", sessionKey: undefined }) },
  )
  makeEventListener(window, "focus", wakeCurrent)
  makeEventListener(document, "visibilitychange", wakeCurrent)
  makeEventListener(document, "pointerdown", wakeCurrent)
  makeEventListener(document, "keydown", wakeCurrent)

  const attached = (session: Session) => sessionAttached(state.machine, session.key)

  const available = (session: SessionRef) =>
    serverSupported(state.machine, session.server.id) && !!session.id && session.server.compatible && !layout.narrow()

  const tab = (session: Session, tabID: string) => sessionTab(state.machine, session.key, tabID)

  const registration = (session: Session) => registrations.get(session.key)?.registration

  const command = (session: Session, action: Browser.Action) =>
    dispatch({ type: "session.command", sessionKey: session.key, action, focusAddress: false })

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

  // The agent's browser.preview tool: the file plugin opens HTML in the browser, other files in the file panel. Only the
  // session's screen resolves workspace paths, so a preview for a session that is not on screen waits for it.
  const preview = (drive: Drive, path: string) => {
    const view = sessions.current()

    if (view?.key === drive.ref.key && ctx.screen.current()) {
      links.open({ href: path, session: view, background: true })

      return
    }

    if (!drive.previews.includes(path)) drive.previews.push(path)
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
      dispatch({ type: "session.command", sessionKey: session.key, action: { type: "tabs.open" }, focusAddress: true })
    },
    /** Whether the user just opened the blank tab this session shows; true once, for the pane that focuses its address. */
    opened(session: Session) {
      const tabID = addressFocusTab(
        untrack(() => state.machine),
        session.key,
      )

      if (!tabID) return false
      dispatch({ type: "address.focused", sessionKey: session.key, tabID })

      return true
    },
    /** A page's icon and zoom, once this desktop reported them. */
    page: (session: Session, tabID: string) => state.pages[session.key]?.[tabID],
    zoom(session: Session, tabID: Browser.TabID, zoom: Zoom) {
      registration(session)?.zoom(tabID, zoom)
    },
    /** The page's cookie count; undefined while the pane cannot answer. */
    site: (session: Session, tabID: Browser.TabID) => registration(session)?.site(tabID),
    /** Deletes the page's cookies and stored data, and reloads it. */
    clearSite: (session: Session, tabID: Browser.TabID) => registration(session)?.clearSite(tabID),
    /** Pages the browser showed, newest first. */
    visits: () => history.value.visits,
    clearHistory: () => {
      recorded.clear()
      history.set({ visits: [] })
    },
    pending: (session: SessionRef) => sessionPending(state.machine, session),
    /**
     * Tab IDs to list in the side panel: the desktop's inventory, limited to tabs stored in the strip. Until the first
     * inventory arrives, the stored tabs, so a restored selection holds; that inventory then prunes the ones it lacks.
     */
    tabs: (session: SessionRef, open: readonly string[]) => sessionTabs(state.machine, session, open),
    error(session: Session) {
      const code = sessionError(state.machine, session.key)

      return code === undefined ? undefined : describe(code)
    },
    suspended: (session: Session) => sessionSuspended(state.machine, session.key),
    /** The host embed of a tab's page, once main created the page. */
    embed: (session: Session, tabID: string) => sessionEmbed(state.machine, session.key, tabID),
    /**
     * Creates a restored tab's page, which then reports its embed. Holds for the caller's scope: a new registration,
     * e.g. after a suspension, has no page for the tab and loads it again.
     */
    load(session: Session, tabID: Browser.TabID) {
      createKeyed(
        () => sessionRegistration(state.machine, session.key),
        () => registration(session)?.load(tabID),
      )
    },
    closeTab(session: Session, tabID: string) {
      const item = tab(session, tabID)

      if (item) command(session, { type: "tabs.close", tabID: item.id })
    },
    /** Closes a tab through the strip, as its close button does, so ⌘⇧T can reopen it. */
    close(session: SessionRef, tabID: string) {
      if (layout.state(key(tabID), session) === "closed") return this.closeTab(session, tabID)
      layout.close(key(tabID), session)
    },
    focusTab(session: Session, tabID: string) {
      const item = tab(session, tabID)

      if (item && item.id !== sessionBrowser(state.machine, session.key)?.focusedTabID)
        command(session, { type: "tabs.focus", tabID: item.id })
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
      registration(session)?.inspect(tabID, enabled)
    },
    /** Flashes a picked element, or clears any highlight when ref is omitted. */
    highlight(session: Session, tabID: Browser.TabID, ref?: Browser.Ref) {
      registration(session)?.highlight(tabID, ref)
    },
    /** Shows the browser tab a comment names and flashes its element while the page still has it. */
    reveal(session: SessionRef, href: string) {
      const target = readHref(href)
      const item = target && tab(session, target.tabID)

      if (!item) return
      layout.open(key(item.id), session, { tab: "select" })

      if (target.ref) registration(session)?.highlight(item.id, target.ref)
    },
    pane: () => panes()[0],
    mount(handle: PaneHandle) {
      setPanes((list) => [handle, ...list])

      return () => setPanes((list) => list.filter((item) => item !== handle))
    },
  }
}
