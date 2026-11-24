import { FileVerificationError } from "./file-verification"
import { builtinContext } from "@opencode/plugin/gui/builtin"
import { FileSource } from "../file/contract"
import { ACTIVATION_DELAY_MS } from "./activation-delay"
import { attachable, attachesUnopened } from "./prompt-gate"
import { batch, createRoot, createSignal, getOwner, onCleanup, untrack } from "solid-js"
import { createStore, reconcile, unwrap } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import type { Browser } from "@opencode/plugin-browser/rpc"
import type { ExperimentalBrowserTab } from "@opencode/plugin/gui/browser"
import { createKeyed, type SessionRef, type SetupContext } from "@opencode/plugin/gui"
import { readHref } from "./comment"
import { commandFailure, refusalText } from "./failure"
import {
  openBinding,
  unavailable,
  type InspectEvent,
  type PageEvent,
  type Registration,
  type ShortcutEvent,
  type Zoom,
} from "./connection"
import { BrowserHistory } from "./history/ipc"
import { pageKey } from "./history/page"
import { HISTORY_ANSWER } from "./history/suggest"
import { recordable, remember, withIcon } from "./history/visits"
import { forgetTabs, saveIcon, saveTabs } from "./saved-tabs"
import type definition from "./index"
import { workspaceFileURL } from "./link"
import { workspacePrefix } from "./remote-address"
import {
  BrowserPane,
  type FindAction,
  type FindView,
  type PaneEvent,
  type PromptAnswer,
  type PromptView,
  type RefusalNotice,
  type Viewport,
} from "./ipc"
import {
  addressFocusTab,
  createInitialState,
  sessionSupported,
  sessionAttached,
  sessionBrowser,
  sessionEmbed,
  sessionFailure,
  sessionPending,
  sessionRegistration,
  sessionAttaching,
  sessionSuspended,
  sessionTab,
  sessionTabs,
  sessionUnavailable,
  tabUnnamed,
  unseenActivity,
  revealGuard,
  transition,
  type Event,
  type Ipc,
  type MachineEffect,
  type State,
} from "./machine"

type Session = Pick<SessionRef, "key">

type Binding = { attempt: number; registration: Registration; choices: Map<Browser.TabID, Viewport> }

/** A session the machine attached: its ref, and the I/O its effects drive. */
type Drive = {
  ref: SessionRef
  /** The agent's previews waiting for the session's screen, which resolves their paths. */
  dispose: () => void
}

type ModelState = {
  machine: State
  /** Presentation details for the tabs in each desktop binding. */
  pages: Record<string, Record<string, PageEvent | undefined> | undefined>
  chrome: Record<
    string,
    Record<string, { find?: FindView; notice?: { notice: RefusalNotice; token: string; site?: string }; prompt?: PromptView } | undefined> | undefined
  >
}

/** A mounted pane. Commands target the newest visible pane. */
type PaneHandle = {
  visible: () => boolean
  address: () => string
  reload: (ignoreCache?: boolean) => void
  /** Closes the selected browser tab, including a blank page. */
  close: () => void
  inspectable: () => boolean
  /** Turns the element picker on or off. */
  inspect: () => void
  toggleToolbar: () => void
  /** Focuses the address field and selects its text. */
  focusAddress: () => void
  find: () => void
  findMatch: (direction: "next" | "previous") => void
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
  const filesPanel = ctx.use(FileSource)
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

  // Main's history of every page, which the address field searches. Away on the web and while main's plugin restarts:
  // the window's own list of the last pages then answers alone.
  const historyIpc = ctx.use(BrowserHistory)

  const historyClient = () => {
    const current = historyIpc()

    return current.status === "active" ? current.value : undefined
  }

  const owner = getOwner()
  const history = ctx.stores.history
  const saved = ctx.stores.tabs
  const [state, setState] = createStore<ModelState>({ machine: createInitialState(untrack(ipc)), pages: {}, chrome: {} })
  const machine = () => state.machine
  const [panes, setPanes] = createSignal<readonly PaneHandle[]>([])
  const visiblePane = () => panes().find((handle) => handle.visible())
  // The I/O handles the machine's effects drive. They are never read as state.
  const drives = new Map<string, Drive>()
  const registrations = new Map<string, Binding>()
  const registerTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const revealTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const heldTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const listeners = new Map<string, (event: PaneEvent) => void>()
  const inspectors = new Map<string, Set<(event: InspectEvent) => void>>()
  // Each tab's last recorded page, so a state that repeats it does not write the history again.
  const recorded = new Map<string, string>()
  const key = (tabID: string) => `${ctx.id}:${tabID}`

  // A failure code `failure.ts` has no sentence for still reads as what the person tried. It is logged with its code,
  // which is main's message, and the action, so a new one is noticed and gets a sentence of its own. As one string:
  // the desktop log writes each argument with `String()`, which turns an object of fields into "[object Object]".
  const noteFailure = (code: string, action: Browser.Action | undefined) => {
    if (!commandFailure(code, action?.type).known)
      console.warn(`[browser] unmapped failure: ${code.slice(0, 300)} (action: ${action?.type ?? "none"})`)
  }

  const dispatch = (event: Event) => {
    // Reads from reactive computations, such as a pane's `opened`, must not subscribe them to every state change.
    const previous = untrack(() => unwrap(state.machine))
    const next = transition(previous, event)

    // The state lands before the effects: closing a strip tab asks this model whether the desktop still has it.
    // Reconciled field by field, as the pane's memos count changes of a tab's fields; a whole new state would wake
    // every reader on every event. `reconcile` writes into the store's objects in place, so the store takes a copy
    // and never holds an object of the machine's.
    if (next.state !== previous) setState("machine", reconcile(structuredClone(next.state)))
    next.effects.forEach(run)
  }

  const run = (effect: MachineEffect) => {
    if (effect.type === "expire-reveal")
      return schedule(revealTimers, effect.sessionKey, ACTIVATION_DELAY_MS, () =>
        dispatch({ type: "reveal.elapsed", sessionKey: effect.sessionKey, token: effect.token }),
      )

    if (effect.type === "expire-held")
      return schedule(heldTimers, effect.sessionKey, effect.delayMs, () =>
        dispatch({ type: "held.expired", sessionKey: effect.sessionKey, token: effect.token }),
      )

    if (effect.type === "present-held") {
      const drive = drives.get(effect.sessionKey)

      if (!drive) return
      restore(drive.ref)

      // Asked again as a request that arrives now, so the screen, the pane and the setting are read now.
      return dispatch({ ...presentation(drive), type: "pane.activity", attempt: effect.attempt, tabID: effect.tabID, reveal: effect.reveal, visible: layout.state(key(effect.tabID), drive.ref) === "visible" })
    }

    if (effect.type === "present-file") {
      const view = sessions.current()
      const files = filesPanel()

      // Nobody pressed anything for this file: the file panel holds a tab it selects this way behind its own guard.
      if (view?.key === effect.sessionKey && files.status === "active") files.value.open(view, effect.path, effect.select ? "select" : "append", true)

      return
    }

    if (effect.type === "open-registration") return open(effect)

    if (effect.type === "close-registration") {
      const current = registrations.get(effect.sessionKey)

      if (current?.attempt !== effect.attempt) return
      registrations.delete(effect.sessionKey)
      setState("chrome", effect.sessionKey, undefined)
      setState("pages", effect.sessionKey, undefined)
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
          action: effect.action,
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

    if (effect.type === "record-history") {
      save(effect.sessionKey)

      return record(effect.sessionKey)
    }

    if (effect.type === "detach") return detach(effect.sessionKey)

    if (effect.type === "forget-tabs") {
      const ref = drives.get(effect.sessionKey)?.ref
      const rest = forgetTabs(saved.value, effect.sessionKey)

      if (rest) saved.set(rest)

      if (ref) void client()?.forget({server: ref.server.id, session:ref.id}).catch(() => undefined)
    }
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
      choices: new Map(),
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

  // What is true now for an agent's show request. On screen means the person can see the session: it is routed, in a
  // window that is neither hidden nor minimized.
  const presentation = (drive: Drive) => ({
    sessionKey: drive.ref.key,
    enabled: ctx.stores.preferences.value.agentPages !== false,
    onScreen: sessions.current()?.key === drive.ref.key && document.visibilityState === "visible",
    room: !layout.narrow() && builtinContext(ctx).layout.fitsSide(),
    opened: layout.side.opened(drive.ref),
  })

  // The browser tabs the session's strip stores, once the stored layout has loaded: before that it reads as empty.
  const stored = (ref: SessionRef) => (layout.ready() ? untrack(() => layout.stored(ref)) : undefined)

  // The host can drop a session's strip with no plugin hearing of it. Before the strip is written for one tab, and
  // when the person comes to the session, it gets back the tabs the desktop still holds, so no tab stands alone.
  const restore = (ref: SessionRef) => {
    const kept = stored(ref)

    if (kept) dispatch({ type: "strip.read", sessionKey: ref.key, stored: kept })
  }

  const receive = (drive: Drive, attempt: number, event: PaneEvent) => {
    const sessionKey = drive.ref.key

    // What the tab waits on the user for, kept per tab, so it shows again when the tab comes to front.
    if (event.type === "prompt") {
      // The strip closes a tab before main asks its page; one that asks to stay shows again, with "Leave site?".
      if (event.prompt?.ask.kind === "leave" && layout.state(key(event.tabID), drive.ref) === "closed")
        layout.open(key(event.tabID), drive.ref, { tab: "select" })

      return setState("chrome", sessionKey, (old) => ({
        ...old,
        [event.tabID]: { ...old?.[event.tabID], prompt: event.prompt ?? undefined },
      }))
    }

    if (event.type === "find" || event.type === "refusal") {
      setState("chrome", sessionKey, (old) => ({ ...old, [event.tabID]: {
        ...old?.[event.tabID], ...(event.type === "find" ? { find: event.view ?? undefined } : { notice: { notice: event.notice, token: event.token, site: event.site } }),
      } }))

      return
    }

    if (event.type === "state") {
      const open = event.state?.tabs
      Object.keys(state.chrome[sessionKey] ?? {}).forEach((id) => {
        const tab = open?.find((item) => item.id === id)

        if (!tab) return setState("chrome", sessionKey, id, undefined)

        if (tab.generation !== sessionTab(machine(), sessionKey, id)?.generation) setState("chrome", sessionKey, id, "notice", undefined)
      })

      if (event.error !== undefined) noteFailure(event.error, undefined)

      return dispatch({ type: "pane.state", sessionKey, attempt, state: event.state, error: event.error, unnamed: event.unnamed, placed: event.placed, stored: stored(drive.ref) })
    }

    if (event.type === "embed")
      return dispatch({ type: "pane.embed", sessionKey, attempt, tabID: event.tabID, embed: event.embed })

    if (event.type === "focus") {
      restore(drive.ref)

      return dispatch({ type: "pane.focus", sessionKey, attempt, tabID: event.tabID })
    }

    if (event.type === "activity" || event.type === "preview") {
      if (event.type === "preview") return dispatch({ ...presentation(drive), attempt, type: "pane.file", path: event.path })
      restore(drive.ref)

      return dispatch({ ...presentation(drive), attempt, type: "pane.activity", tabID: event.tabID, reveal: event.reveal, visible: layout.state(key(event.tabID), drive.ref) === "visible" })
    }

    if (event.type === "inspect") return inspectors.get(sessionKey)?.forEach((listener) => listener(event))

    if (event.type === "page") return page(sessionKey, event)

    // Only the pane on screen holds the page that had focus.
    if (sessions.current()?.key !== sessionKey) return

    if (event.type === "shortcut") return visiblePane()?.press(event)

    if (event.type === "hardReload") return visiblePane()?.reload(true)
    visiblePane()?.focused()
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
          action: effect.action,
          error: "browser.pane.unavailable",
          unavailable: true,
        }),
      )

    void current.registration.command(effect.action).then(
      () => dispatch({ type: "command.settled", sessionKey, request: effect.request }),
      (cause: unknown) => {
        const error = cause instanceof Error && cause.message ? cause.message : "browser.command.failed"

        // In sight even while the pane is not, as when a link in the conversation asked for it.
        if ((error === "browser.artifact.missing" || error === FileVerificationError.code) && !ctx.signal.aborted)
          ctx.toast.show({ title: ctx.t(error === "browser.artifact.missing" ? "artifact.missing" : "preview.verificationUnavailable"), variant: "error" })

        if (!unavailable(cause)) noteFailure(error, effect.action)
        dispatch({
          type: "command.failed",
          sessionKey,
          attempt: effect.attempt,
          request: effect.request,
          action: effect.action,
          error,
          unavailable: unavailable(cause),
        })
      },
    )
  }

  // Closes every stored tab a native inventory lacks, then adds the tabs it newly lists and the ones the strip lost.
  const syncStrip = (effect: Extract<MachineEffect, { type: "sync-strip" }>) => {
    const ref = drives.get(effect.sessionKey)?.ref

    if (!ref) return
    const keep = effect.keep ? new Set<string>(effect.keep) : undefined

    batch(() => {
      if (keep) {
        const choices = registrations.get(effect.sessionKey)?.choices
        choices?.forEach((_, id) => {
          if (!keep.has(id)) choices.delete(id)
        })
        Object.keys(state.pages[effect.sessionKey] ?? {}).forEach((id) => {
          if (!keep.has(id)) setState("pages", effect.sessionKey, id, undefined)
        })
        layout
          .stored(ref)
          .filter((tabID) => !keep.has(tabID))
          .forEach((tabID) => layout.close(key(tabID), ref))
      }

      effect.open.forEach((tabID) => {
        if (layout.state(key(tabID), ref) !== "closed") return
        // A tab a page or link opened stands after the tab it came from, and one the strip lost after the tab before
        // it; the strip holds other panels' tabs too.
        const after = effect.placed?.find((item) => item.tabID === tabID)?.after
        builtinContext(ctx).layout.open(key(tabID), ref, { tab: "append", after: after && key(after) })
      })
    })
  }

  // The session's tabs as the desktop reports them. The strip draws them when the app opens again, before the desktop
  // has attached, and holds each label until the tab's page has its own again.
  const save = (sessionKey: string) => {
    const tabs = sessionBrowser(machine(), sessionKey)?.tabs
    const next = tabs && saveTabs(saved.value, sessionKey, tabs)

    if (next) saved.set(next)
  }

  // Pages the user or the agent opened, once loaded: only a tab whose page exists has a real URL and title, as a
  // restored tab's saved URL carries no title until it loads again. Only the desktop's own reports count: a restored
  // tab's embed arrives before its page loads, with the saved URL as if it had.
  const record = (sessionKey: string) => {
    const current = machine()
    const attachment = current.status === "open" ? current.sessions[sessionKey] : undefined

    attachment?.browser?.tabs.forEach((tab) => {
      if (tab.loading || tab.loadError || !attachment.embeds[tab.id] || !recordable(tab.url)) return
      const visit = `${tab.url}\n${tab.title}`

      const previous = recorded.get(`${sessionKey}\n${tab.id}`)

      if (previous === visit) return
      recorded.set(`${sessionKey}\n${tab.id}`, visit)
      history.set({
        visits: remember(
          history.value.visits,
          tab.url.startsWith("artifact:") ? { url: tab.url, title: tab.title, session: sessionKey } : { url: tab.url, title: tab.title },
          state.pages[sessionKey]?.[tab.id]?.icon,
        ),
      })

      // Main's history counts the visit; a page that only reported its title since is the same visit. Main keeps web
      // pages alone, and a visit it misses while it is away is one the window's list still has.
      const page = { url: tab.url, title: tab.title }
      const main = pageKey(tab.url) ? historyClient() : undefined
      const sent = previous?.startsWith(`${tab.url}\n`) ? main?.retitle(page, { signal: ctx.signal }) : main?.visit(page, { signal: ctx.signal })
      void sent?.catch(() => undefined)
    })
  }

  const page = (sessionKey: string, event: PageEvent) => {
    setState("pages", sessionKey, { [event.tabID]: event })
    const url = sessionTab(machine(), sessionKey, event.tabID)?.url
    const visits = url && event.icon ? withIcon(history.value.visits, url, event.icon) : undefined

    if (visits) history.set({ visits })
    const kept = event.icon ? saveIcon(saved.value, sessionKey, event.tabID, event.icon) : undefined

    if (kept) saved.set(kept)
  }

  const detach = (sessionKey: string) => {
    cancel(revealTimers, sessionKey)
    cancel(heldTimers, sessionKey)
    const drive = drives.get(sessionKey)
    drives.delete(sessionKey)
    drive?.dispose()
    Array.from(recorded.keys())
      .filter((item) => item.startsWith(`${sessionKey}\n`))
      .forEach((item) => recorded.delete(item))
    setState("pages", sessionKey, undefined)
    setState("chrome", sessionKey, undefined)
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
    {
      // A pane that is starting and one that does not run are both no pane here, and they differ: a starting one
      // attaches by itself, so a prompt waits for it, and one that failed to start never does.
      otherwise: () =>
        createKeyed(
          () => ipc().status,
          () => dispatch({ type: "ipc.changed", ipc: untrack(ipc) }),
        ),
    },
  )

  const attach = (ref: SessionRef) => {
    const sessionKey = ref.key

    if (drives.has(sessionKey)) return
    const drive: Drive = { ref, dispose: () => undefined }
    drives.set(sessionKey, drive)
    dispatch({ type: "session.attached", sessionKey, serverID: ref.server.id, located: !!ref.location })

    // The attachment's own root, not the route effect that happened to call attach(), so `detach` ends it.
    drive.dispose = createRoot((dispose) => {
      // A new session appears in the UI before its server-side creation finishes. The listeners follow the server's
      // live data: a re-authenticated server gets a new controller under the same ref.
      let controller = ref.server.data
      createKeyed(
        () => ref.server.data,
        (data) => {
          if (data !== controller) dispatch({type:"session.rebind", sessionKey})
          controller = data
          const changed = () => dispatch({type:"session.capability.changed", sessionKey})
          onCleanup(data.on("plugin.updated", changed))
          onCleanup(data.on("server.connected", changed))
          // The server reports every inbox item. Only the person's prompts are tracked, from the moment they enter.
          onCleanup(data.on("session.inbox.enqueued", (event) => {
            if (event.data.sessionID === ref.id && event.data.item.type === "user")
              dispatch({ type: "prompt.enqueued", sessionKey, id: event.data.inboxID, delivery: event.data.item.delivery })
          }))
          onCleanup(data.on("session.inbox.delivery.changed", (event) => {
            if (event.data.sessionID === ref.id)
              dispatch({ type: "inbox.delivery.changed", sessionKey, id: event.data.inboxID, delivery: event.data.delivery })
          }))
          onCleanup(data.on("session.inbox.delivered", (event) => {
            if (event.data.sessionID === ref.id) dispatch({ type: "inbox.delivered", sessionKey, id: event.data.inboxID })
          }))
          onCleanup(data.on("session.inbox.cancelled", (event) => {
            if (event.data.sessionID === ref.id) dispatch({ type: "inbox.cancelled", sessionKey, id: event.data.inboxID })
          }))
          onCleanup(data.on("session.deleted", event => {
            if (event.data.sessionID === ref.id) dispatch({type:"session.removed", sessionKeys:[sessionKey]})
          }))
          onCleanup(data.on("session.moved", event => {
            if (event.data.sessionID === ref.id) dispatch({type:"session.rebind", sessionKey})
          }))
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

      // The shell list is a view, not a deletion log. It can disappear during re-authentication or a refresh.
      createKeyed(() => layout.side.opened(ref) ? "open" : "closed", side => dispatch({
        type: "side.changed", sessionKey, open: side === "open",
        running: sessions.current()?.key === sessionKey && ref.server.data.session.status(ref.id) === "running",
      }))
      createKeyed(() => ref.server.data.session.status(ref.id) !== "running", () => dispatch({ type: "execution.ended", sessionKey }))

      createKeyed(() => sessions.list().some(item => item.key === sessionKey && item.server.compatible) ? "listed" : "absent",
        value => dispatch({ type:"session.presence", sessionKey, listed:value === "listed" }))

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

      return dispose
    }, owner)
  }

  // The routed session attaches, once its server is compatible and has the browser RPC.
  createKeyed(() => {
    const view = sessions.current()

    if (!view?.id) return
    const ref = sessions.list().find((item) => item.key === view.key)

    return ref?.server.compatible ? ref : undefined
  }, attach)

  onCleanup(() => {
    dispatch({ type: "disposed" })
    recorded.clear()
  })

  // These are edges, not a reactive dependency on suspended state: eviction while the window
  // remains focused must not immediately reopen the browser and defeat resource cleanup.
  createKeyed(
    () => sessions.current()?.key,
    (sessionKey) => {
      const drive = drives.get(sessionKey)

      dispatch({ type: "session.routed", sessionKey })

      // Now, not with the desktop's next report, which a quiet page never sends.
      if (drive) restore(drive.ref)
      wakeCurrent()
      // The route moved on: the person no longer sees this session.
      onCleanup(() => dispatch({ type: "screen.left", sessionKey }))
    },
    { otherwise: () => dispatch({ type: "session.routed", sessionKey: undefined }) },
  )
  makeEventListener(window, "focus", wakeCurrent)
  makeEventListener(document, "visibilitychange", wakeCurrent)
  // The window is neither hidden nor minimized, so the person sees what a pane draws.
  const [windowShown, setWindowShown] = createSignal(document.visibilityState === "visible")
  makeEventListener(document, "visibilitychange", () => {
    const shown = document.visibilityState === "visible"
    const view = sessions.current()

    setWindowShown(shown)

    if (!shown && view) dispatch({ type: "screen.left", sessionKey: view.key })
  })
  makeEventListener(document, "pointerdown", wakeCurrent)
  makeEventListener(document, "keydown", wakeCurrent)

  const attached = (session: Session) => sessionAttached(machine(), session.key)

  const available = (session: SessionRef) =>
    sessionSupported(machine(), session.key) && !!session.id && session.server.compatible && !layout.narrow()

  const tab = (session: Session, tabID: string) => sessionTab(machine(), session.key, tabID)

  const registration = (session: Session) => registrations.get(session.key)?.registration

  const requireBinding = (session: Session) => {
    const current = registrations.get(session.key)

    if (!current) throw new Error("browser.pane.unavailable")

    return current
  }

  const command = (session: Session, action: Browser.Action) =>
    dispatch({ type: "session.command", sessionKey: session.key, action, focusAddress: false })

  const openURL = (session: Session, url: string) => command(session, { type: "tabs.open", url })

  // Only the routed session has a file model to resolve workspace paths with: the session screen's.
  const files = (session: Session) => {
    const screen = ctx.screen.current()

    return screen && sessions.current()?.key === session.key ? screen.file : undefined
  }

  // Both kinds of binding can open workspace files. Only the disk owner interprets their paths.
  const canOpen = (session: SessionRef, path?: string) => {
    if (!available(session) || !attached(session)) return false

    if (path === undefined) return true
    const current = files(session)

    return !!current && !current.absolute(path)
  }

  const openFile = (session: SessionRef, path: string) => {
    const current = files(session)

    if (current) openURL(session, workspaceFileURL(current.root, path, session.server.builtin ? undefined : session.id))
  }

  // The window has a network connection, as far as the system knows.
  const [online, setOnline] = createSignal(navigator.onLine)
  makeEventListener(window, "online", () => setOnline(true))
  makeEventListener(window, "offline", () => setOnline(false))

  // A prompt waits only while an attachment for its session is in flight on a server that can answer it.
  const attaching = (session: SessionRef) => sessionAttaching(machine(), session.key, attachable(session, online()))

  // A session that runs in a tab nobody has opened since the app started attaches as the routed one does. Keyed by the
  // sessions it applies to, so each attaches once when it starts to run, and a later run wakes its attachment itself.
  const unopened = () => sessions.list().filter((ref) => attachesUnopened(ref, online()))
  createKeyed(
    () => unopened().map((ref) => ref.key).join("\n"),
    () => unopened().forEach(attach),
  )

  // A prompt is about to go to the session. Its first step lists the browser tools only if the server already holds
  // this desktop's attachment, so the session attaches now, routed or not, and the send waits while that is in flight
  // and can still succeed. In every other state it resolves at once: a server that is not connected or not compatible,
  // a window that is offline, a session another desktop owns, one the server lacks or has no browser for, one with no
  // location, a pane that does not run. The server going away, this plugin being disposed and the host's `signal` each
  // end a wait at once.
  const ready = (session: SessionRef, signal: AbortSignal) => {
    if (!untrack(() => attachable(session, online()))) return Promise.resolve()
    attach(session)
    dispatch({ type: "session.wake", sessionKey: session.key })

    if (!untrack(() => attaching(session)) || signal.aborted) return Promise.resolve()
    const settled = Promise.withResolvers<void>()

    const dispose = createRoot((dispose) => {
      createKeyed(
        () => !attaching(session),
        () => settled.resolve(),
      )
      // The plugin's owner disposes this root before the machine hears of it, which would leave the wait to the host's
      // timeout.
      onCleanup(() => settled.resolve())

      return dispose
    }, owner)

    signal.addEventListener("abort", () => settled.resolve(), { once: true })

    return settled.promise.finally(dispose)
  }

  return {
    available,
    attached,
    ready,
    canOpen,
    openFile,
    openURL,
    async createTab(sessionKey: string, owner: string, url: string) {
      if (sessions.current()?.key !== sessionKey) throw new Error("browser.pane.notOnScreen")
      const ref = sessions.list().find(item => item.key === sessionKey)

      if (ref?.server.compatible) attach(ref)
      dispatch({ type: "session.wake", sessionKey })
      const target = registrations.get(sessionKey)

      if (!target) throw new Error("browser.pane.unavailable")

      return target.registration.createTab(owner, url, () => sessions.current()?.key === sessionKey)
    },
    async closeOwned(sessionKey: string, owner: string, id: ExperimentalBrowserTab) {
      dispatch({ type: "session.wake", sessionKey })
      const target = registrations.get(sessionKey)

      if (!target) return false

      return target.registration.closeTab(owner, id)
    },
    command,
    tab,
    /** Opens a blank tab for the user, whose pane then focuses the address field. */
    open(session: SessionRef) {
      if (!available(session)) return
      dispatch({ type: "session.command", sessionKey: session.key, action: { type: "tabs.open" }, focusAddress: true })
    },
    /** Whether the user just opened this blank tab; true once, for the pane that focuses its address. */
    opened(session: Session, tabID: Browser.TabID) {
      if (addressFocusTab(untrack(machine), session.key) !== tabID) return false
      dispatch({ type: "address.focused", sessionKey: session.key, tabID })

      return true
    },
    /** The page's presentation details, once reported by its native tab. */
    page: (session: Session, tabID: string) => state.pages[session.key]?.[tabID],
    search: (session: Session, tabID: string) => state.chrome[session.key]?.[tabID]?.find,
    reviewLink(session: SessionRef, url: string) {
      if (!available(session)) return

      if (url.length > 2048) {
        ctx.toast.show({ title: ctx.t("refused.web") })

        return Promise.resolve()
      }

      return registration(session)?.reviewLink(url).then((id) => {
        if (!ctx.signal.aborted && sessions.current()?.key === session.key) layout.open(key(id), session, { tab: "select" })
      })
    },
    notice(session: Session, tabID: string) {
      const entry = state.chrome[session.key]?.[tabID]?.notice

      if (!entry) return
      // `entry.site` is the tab's origin when main made the notice. A passkey notice's own `site` is the registrable
      // domain the import searches for; never let one stand in for the other.
      const notice = entry.notice
      const conversation = "source" in notice && notice.source === "conversation"
      const origin = conversation ? ctx.t("notice.conversation") : entry.site ? ctx.t("notice.site", { site: entry.site }) : ctx.t("notice.page")

      if (notice.reason === "external" || notice.reason === "popup") return {
        token: entry.token,
        origin,
        opensApp: notice.action === "open",
        text: notice.reason === "external" ? ctx.t("refused.scheme", { scheme: notice.target.split(":", 1)[0] }) : ctx.t("refused.popup"), target: notice.target,
        label: notice.action && ctx.t(notice.action === "copy" ? "link.copy" : "refused.open"),
      }

      // Where the system's dialog works, a new tab does; elsewhere the action brings the site's sign-in from the user's
      // own browser, which the pane opens the import for, with the site chosen only in a tab of the person's.
      // The new tab opens the origin the tab was on when main made the notice, which the button names: never the
      // agent's path, and never an address the page changed since.
      if (notice.reason === "browser.passkey.off")
        return entry.site
          ? { token: entry.token, origin, text: ctx.t("refused.passkey.off"), label: ctx.t("refused.passkey.newTab"), title: entry.site, passkey: { newTab: entry.site } }
          : { token: entry.token, origin, text: ctx.t("refused.passkey.off") }

      if (notice.reason === "browser.passkey" || notice.reason === "browser.passkey.agent")
        return {
          token: entry.token,
          origin,
          text: ctx.t("refused.passkey"),
          label: ctx.t("refused.passkey.import"),
          passkey: { site: notice.site, choose: notice.reason === "browser.passkey" },
        }

      return { token: entry.token, origin, text: ctx.t(refusalText(notice.reason)) }
    },
    async answerNotice(session: Session, tabID: Browser.TabID, dismiss: boolean, copy?: boolean) {
      const notice = state.chrome[session.key]?.[tabID]?.notice

      if (!notice) return
      setState("chrome", session.key, tabID, "notice", undefined)
      const target = registration(session)

      if (!target) throw new Error("browser.pane.unavailable")
      await target.notice(tabID, notice.token, dismiss, copy)
    },
    /** What the tab waits on the user for. */
    prompt: (session: Session, tabID: string) => state.chrome[session.key]?.[tabID]?.prompt,
    /**
     * A tab the pane does not show waits on the user, which its strip tab shows. The layout decides, not the
     * desktop's focused tab: Review or a file in front hides the browser's focused tab too.
     */
    asking(session: Session, tabID: string) {
      const ref = drives.get(session.key)?.ref

      return !!ref && !!state.chrome[session.key]?.[tabID]?.prompt && layout.state(key(tabID), ref) !== "visible"
    },
    unseen: (session: Session, tabID: string) => unseenActivity(machine(), session.key, tabID),
    /** The tab keeps its new-tab label until its page names itself. */
    unnamed: (session: Session, tabID: string) => tabUnnamed(machine(), session.key, tabID),
    seen: (session: Session, tabID: Browser.TabID) => dispatch({ type: "activity.seen", sessionKey: session.key, tabID }),
    revealGuard: (session: Session, tabID: string) => revealGuard(machine(), session.key, tabID),
    windowShown,
    /** The pane now shows the person the tab an agent's show request selected, which starts the guard's delay. */
    revealDrawn: (session: Session, token: number) => dispatch({ type: "reveal.drawn", sessionKey: session.key, token }),
    answer(session: Session, tabID: Browser.TabID, id: number, answer: PromptAnswer) {
      return registration(session)?.answer(tabID, id, answer) ?? Promise.reject(new Error("browser.pane.unavailable"))
    },
    find(session: Session, tabID: Browser.TabID, action: FindAction) {
      return registration(session)?.find(tabID, action) ?? Promise.reject(new Error("browser.pane.unavailable"))
    },
    zoom(session: Session, tabID: Browser.TabID, zoom: Zoom) {
      registration(session)?.zoom(tabID, zoom)
    },
    async setViewport(session: Session, tabID: Browser.TabID, viewport: Viewport) {
      const current = requireBinding(session)
      current.choices.set(tabID, viewport)

      return current.registration.setViewport(tabID, viewport).catch((error) => {
        if (current.choices.get(tabID) === viewport) current.choices.delete(tabID)
        throw error
      })
    },
    async toggleViewport(session: Session, tabID: Browser.TabID, open: boolean) {
      const current = requireBinding(session)

      const page = state.pages[session.key]?.[tabID]

      if (open) {
        const choice = current.choices.get(tabID)

        if (choice?.mode !== "fixed" || page?.zoom !== 1) return

        return current.registration.setViewport(tabID, choice)
      }

      // A reattached page can already have a device. Keep that choice unless a newer edit is in flight.
      if (!current.choices.has(tabID) && page?.viewport.mode === "fixed") current.choices.set(tabID, page.viewport)

      return current.registration.setViewport(tabID, { mode: "auto" })
    },
    /** The page's cookie count; undefined while the pane cannot answer. */
    site: (session: Session, tabID: Browser.TabID) => registration(session)?.site(tabID),
    binding: (session: Session) => registration(session)?.binding,
    /** Deletes the page's cookies and stored data, and reloads it. */
    clearSite: (session: Session, tabID: Browser.TabID) => registration(session)?.clearSite(tabID),
    clearCache: (session: Session, tabID: Browser.TabID, address: string) => registration(session)?.clearCache(tabID, address),
    revealFile: (session: Session, tabID: Browser.TabID) => registration(session)?.reveal(tabID),
    openPage: (session: Session, tabID: Browser.TabID, expected: string) =>
      registration(session)?.openPage(tabID, expected) ?? Promise.reject(new Error("browser.pane.unavailable")),
    /** Pages the browser showed, newest first. */
    visits: () => history.value.visits.filter((visit) => {
      const session = sessions.current()

      if (visit.url.startsWith("file:")) return session?.server.builtin

      if (visit.session) return visit.session === session?.key

      return !visit.url.startsWith("workspace:") || (!!session?.id && visit.url.startsWith(workspacePrefix(session.id)))
    }),
    /**
     * Whether there may be history to clear: the window's list has pages, or this is the desktop app, where main's
     * history may hold pages the window never listed, as imported ones.
     */
    historyClearable: () => history.value.visits.length > 0 || !!ctx.desktop,
    /**
     * Forgets every page: the window's list, and main's history with the pages imported from other browsers. Answers
     * whether main's history went, so the pane never lets the person believe it did: false when main could not clear
     * it, or cannot be reached. On the web there is no history but the window's list.
     */
    clearHistory: () => {
      recorded.clear()
      history.set({ visits: [] })
      const main = historyClient()

      if (!main) return Promise.resolve(!ctx.desktop)

      return main.clear({ signal: ctx.signal }).then(
        () => true,
        () => false,
      )
    },
    /** The person is about to type an address: main reads its history into memory ahead of the first search. */
    prepareHistory: () => void historyClient()?.prepare({ signal: ctx.signal }).catch(() => undefined),
    /**
     * The pages of main's history that match what the person typed in the address field, best first. None while main
     * is away, as on the web.
     */
    searchHistory: (query: string, signal: AbortSignal) =>
      historyClient()?.search({ query, limit: HISTORY_ANSWER }, { signal: AbortSignal.any([ctx.signal, signal]) }) ?? Promise.resolve([]),
    /** Forgets one page, as the person asked from the address field's suggestions. */
    forgetPage: (url: string) => {
      const key = pageKey(url)

      history.set({ visits: history.value.visits.filter((visit) => visit.url !== url && (!key || pageKey(visit.url) !== key)) })
      void historyClient()?.remove({ url }, { signal: ctx.signal }).catch(() => undefined)
    },
    pending: (session: SessionRef) => sessionPending(machine(), session),
    /** The browser could not open and has no tabs to show: the pane says so and offers `retry`. */
    unavailable: (session: Session) => sessionUnavailable(machine(), session.key),
    retry: (session: Session) => dispatch({ type: "session.retry", sessionKey: session.key }),
    /**
     * Tab IDs to list in the side panel: the desktop's inventory, limited to tabs stored in the strip. Until the first
     * inventory arrives, the stored tabs, so a restored selection holds; that inventory then prunes the ones it lacks.
     */
    tabs: (session: SessionRef, open: readonly string[]) => sessionTabs(machine(), session, open),
    /** The last failure's identity, which changes with every new one; the address field counts them as rejections. */
    error(session: Session) {
      const failure = sessionFailure(machine(), session.key)

      return failure ? `${failure.id}:${failure.code}` : undefined
    },
    /**
     * What to say above a tab's page about a command that did not work or an address the pane refused: never for a
     * load the page area explains, and only in the tab the command was for. `retry` sends the command again.
     */
    failure(session: Session, tabID: string) {
      const failure = sessionFailure(machine(), session.key)

      if (!failure) return
      const action = failure.action
      const view = commandFailure(failure.code, action?.type)

      if (view.surface === "none" || (action && "tabID" in action && action.tabID !== tabID)) return

      return {
        id: failure.id,
        text: ctx.t(view.text),
        lasting: view.lasting,
        retry: view.retry && action ? () => command(session, action) : undefined,
      }
    },
    dismissFailure: (session: Session, id: number) => dispatch({ type: "failure.dismissed", sessionKey: session.key, id }),
    suspended: (session: Session) => sessionSuspended(machine(), session.key),
    /** The host embed of a tab's page, once main created the page. */
    embed: (session: Session, tabID: string) => sessionEmbed(machine(), session.key, tabID),
    /**
     * Creates a restored tab's page, which then reports its embed. Holds for the caller's scope: a new registration,
     * e.g. after a suspension, has no page for the tab and loads it again.
     */
    load(session: Session, tabID: Browser.TabID) {
      createKeyed(
        () => sessionRegistration(machine(), session.key),
        () => registration(session)?.load(tabID),
      )
    },
    closeTab(session: Session, tabID: string) {
      const item = tab(session, tabID)

      if (item) return command(session, { type: "tabs.close", tabID: item.id })
      // A tab drawn from the saved state, which the desktop has not reported yet: its attachment remembers the close.
      const ref = sessions.list().find((entry) => entry.key === session.key)

      if (ref?.server.compatible) attach(ref)
      dispatch({ type: "strip.tab.closed", sessionKey: session.key, tabID })
    },
    /** Closes a tab through the strip, as its close button does, so ⌘⇧T can reopen it. */
    close(session: SessionRef, tabID: string) {
      if (layout.state(key(tabID), session) === "closed") return this.closeTab(session, tabID)
      layout.close(key(tabID), session)
    },
    /** The strip selected a tab. `restored` is the selection it mounted with, not the person's choice. */
    focusTab(session: Session, tabID: string, restored: boolean) {
      const item = tab(session, tabID)

      if (!item) {
        // A tab drawn from the saved state, which the desktop has not reported yet. The desktop restores the tab it
        // had in front by itself, so only the person's pick of one waits for it.
        if (!restored) dispatch({ type: "strip.tab.selected", sessionKey: session.key, tabID })

        return
      }

      dispatch({ type: "activity.seen", sessionKey: session.key, tabID: item.id })

      if (item.id !== sessionBrowser(machine(), session.key)?.focusedTabID)
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
    pane: () => visiblePane() ?? panes()[0],
    mount(handle: PaneHandle) {
      setPanes((list) => [handle, ...list])

      return () => setPanes((list) => list.filter((item) => item !== handle))
    },
  }
}
