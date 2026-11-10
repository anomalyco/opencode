import { Browser } from "@opencode/plugin-browser/rpc"
import { Option, Predicate, Schema } from "effect"
import type { PaneCloseReason, PaneEvent } from "./ipc"

/** How long a binding may wait for the server's `attached` handshake before it closes. */
export const REGISTER_TIMEOUT_MS = 15_000

/**
 * One tab of a binding. A closed tab is absent from its binding's `tabs`.
 *
 * - `unloaded`: only the tab's metadata. A restored tab stays here until the pane shows it or an agent command names
 *   it; a tab whose page crashed returns here, with `loadError`, so it can be loaded again.
 * - `live`: a page exists for `attempt`. Results from an earlier page of the same tab carry another attempt.
 *   `url` is the last address the page reported, kept while a new document has not committed one.
 */
export type TabSlot =
  | { readonly status: "unloaded"; readonly tab: Browser.Tab }
  | { readonly status: "live"; readonly attempt: number; readonly tab: Browser.Tab; readonly url: string }

type Inventory = {
  readonly binding: string
  readonly window: number
  readonly storageKey: string
  readonly tabs: ReadonlyMap<Browser.TabID, TabSlot>
  /** Null or a key of `tabs`. */
  readonly focusedTabID: Browser.TabID | null
  /** The attempt the next page of this binding gets. */
  readonly nextAttempt: number
}

/**
 * One window's registration of a session's pane.
 *
 * - `connecting`: waiting for the server's `attached` handshake; the window's `register` call is pending.
 * - `attached`: the server accepted the attachment; tabs open and agent requests run.
 * - `closed`: final. The first reason wins; every later event is ignored.
 */
export type BindingState =
  | (Inventory & { readonly status: "connecting" })
  | (Inventory & {
      readonly status: "attached"
      /** Workspace directories whose files may load as file:// documents; empty unless the server shares this disk. */
      readonly fileRoots: readonly string[]
      /** Agent requests in flight, with the tab each one targets once known. */
      readonly requests: ReadonlyMap<string, Browser.TabID | undefined>
      /** The last state event reported, so an unchanged state is not sent again. */
      readonly published: string | undefined
    })
  | { readonly status: "closed"; readonly binding: string; readonly reason: PaneCloseReason }

export type ActiveBinding = Exclude<BindingState, { readonly status: "closed" }>

type AttachedBinding = Extract<BindingState, { readonly status: "attached" }>

/** Every binding of the main process, until the plugin goes away. */
export type PaneState =
  | { readonly status: "active"; readonly bindings: ReadonlyMap<string, ActiveBinding> }
  | { readonly status: "disposed" }

/** How the attachment's Effect ended: the attach call's result, or the error it failed with. */
export type AttachmentOutcome = "closed" | "replaced" | "missing" | "unavailable" | "unsupported"

/** A browser control event from the server's stream, as this binding reads it. */
export type ControlFrame =
  | { readonly kind: "foreign" }
  | { readonly kind: "attached" }
  | { readonly kind: "command"; readonly requestID: string }
  | { readonly kind: "cancel"; readonly requestID: string }
  /** An `attached` handshake this desktop cannot decode: the server speaks another protocol version. */
  | { readonly kind: "incompatible" }
  /** Any other event this desktop cannot decode, such as a control type a newer server added. */
  | { readonly kind: "unrecognized"; readonly controlType: string | undefined }

export type StoredRestore = {
  readonly tabs: readonly { readonly id: Browser.TabID; readonly url: string }[]
  readonly focusedTabID: Browser.TabID | null
}

export type BindingEvent =
  | { readonly type: "server.attached"; readonly fileRoots: readonly string[] }
  | { readonly type: "handshake.unsupported" }
  | { readonly type: "control.unrecognized"; readonly controlType: string | undefined }
  | { readonly type: "attachment.ended"; readonly outcome: AttachmentOutcome }
  | { readonly type: "register.timed-out" }
  /** The window navigated or was destroyed. */
  | { readonly type: "owner.closed" }
  /** The window closed the binding; its saved tabs are forgotten. */
  | { readonly type: "client.closed" }
  | { readonly type: "pane.disposed" }
  | { readonly type: "request.started"; readonly requestID: string }
  | { readonly type: "request.targeted"; readonly requestID: string; readonly tabID: Browser.TabID }
  | { readonly type: "request.cancelled"; readonly requestID: string }
  | { readonly type: "request.finished"; readonly requestID: string }
  /** A page for `tabID` was created as `attempt`, the binding's `nextAttempt`. */
  | { readonly type: "tab.opened"; readonly tabID: Browser.TabID; readonly attempt: number; readonly tab: Browser.Tab }
  | {
      readonly type: "tab.published"
      readonly tabID: Browser.TabID
      readonly attempt: number
      readonly tab: Browser.Tab
      readonly error?: string
    }
  /** The page's renderer crashed, its debugger detached, or it failed to become ready. */
  | {
      readonly type: "tab.crashed"
      readonly tabID: Browser.TabID
      readonly attempt: number
      readonly tab?: Browser.Tab
    }
  | { readonly type: "tab.focused"; readonly tabID: Browser.TabID }
  | { readonly type: "tab.closed"; readonly tabID: Browser.TabID }

export type PaneMachineEvent =
  | {
      readonly type: "registered"
      readonly binding: string
      readonly window: number
      readonly storageKey: string
      /** The window's inventory, which wins over the saved one. */
      readonly restore: Browser.State | undefined
      readonly saved: StoredRestore
    }
  | { readonly type: "binding"; readonly binding: string; readonly event: BindingEvent }
  | { readonly type: "disposed" }

type StateEvent = Extract<PaneEvent, { readonly type: "state" }>

export type PaneEffect =
  | { readonly type: "start-timer"; readonly binding: string; readonly ms: number }
  | { readonly type: "resolve-register"; readonly binding: string }
  | { readonly type: "save-restore"; readonly storageKey: string; readonly snapshot: StoredRestore }
  | { readonly type: "remove-restore"; readonly storageKey: string }
  /** To the window and, as the server's copy of the inventory, to the server. */
  | {
      readonly type: "report"
      readonly binding: string
      readonly event: StateEvent & { readonly state: Browser.State }
    }
  /** To the window only. */
  | { readonly type: "emit"; readonly binding: string; readonly event: PaneEvent }
  | { readonly type: "abort-requests"; readonly binding: string; readonly requestIDs: readonly string[] }
  | { readonly type: "release-pages"; readonly binding: string; readonly attempts: readonly number[] }
  /** Rejects a pending `register` call, stops the timer and listeners, and ends the attachment. Always last. */
  | { readonly type: "teardown"; readonly binding: string }
  | { readonly type: "warn"; readonly message: string; readonly detail: string | undefined }

export type BindingTransition = { readonly state: BindingState; readonly effects: readonly PaneEffect[] }

export type PaneTransition = { readonly state: PaneState; readonly effects: readonly PaneEffect[] }

type AttachedTransition = { readonly state: AttachedBinding; readonly effects: readonly PaneEffect[] }

const ControlHeader = Schema.Struct({ connectionID: Schema.String, type: Schema.optional(Schema.String) })

export const decodeControlHeader = Schema.decodeUnknownOption(ControlHeader)

export const decodeControl = Schema.decodeUnknownOption(Browser.Control)

export function createPaneState(): PaneState {
  return { status: "active", bindings: new Map() }
}

/** Reads a control event. Only an `attached` handshake this desktop cannot decode makes the server unsupported. */
export function resolveControlFrame(
  connectionID: string,
  header: Option.Option<typeof ControlHeader.Type>,
  control: Option.Option<Browser.Control>,
): ControlFrame {
  if (Option.isNone(header) || header.value.connectionID !== connectionID) return { kind: "foreign" }

  if (Option.isNone(control))
    return header.value.type === "attached"
      ? { kind: "incompatible" }
      : { kind: "unrecognized", controlType: header.value.type }

  if (control.value.type === "attached") return { kind: "attached" }

  return { kind: control.value.type, requestID: control.value.requestID }
}

export function attachmentFailure(cause: unknown): AttachmentOutcome {
  if (Predicate.isTagged(cause, "SessionNotFoundError")) return "missing"
  const type = Predicate.hasProperty(cause, "type") ? cause.type : undefined

  if (type === "rpc.unavailable") return "unavailable"

  if (type === "rpc.method_not_found" || type === "rpc.invalid_input") return "unsupported"

  return "closed"
}

export function transitionPane(state: PaneState, event: PaneMachineEvent): PaneTransition {
  if (state.status === "disposed") return { state, effects: [] }

  if (event.type === "disposed")
    return {
      state: { status: "disposed" },
      effects: Array.from(state.bindings.values()).flatMap(
        (binding) => transitionBinding(binding, { type: "pane.disposed" }).effects,
      ),
    }

  if (event.type === "registered") {
    if (state.bindings.has(event.binding)) return { state, effects: [] }

    return {
      state: { status: "active", bindings: new Map(state.bindings).set(event.binding, createConnecting(event)) },
      effects: [{ type: "start-timer", binding: event.binding, ms: REGISTER_TIMEOUT_MS }],
    }
  }

  const binding = state.bindings.get(event.binding)

  if (!binding) return { state, effects: [] }
  const next = transitionBinding(binding, event.event)

  if (next.state === binding) return { state, effects: next.effects }
  const bindings = new Map(state.bindings)

  if (next.state.status === "closed") bindings.delete(event.binding)

  if (next.state.status !== "closed") bindings.set(event.binding, next.state)

  return { state: { status: "active", bindings }, effects: next.effects }
}

export function transitionBinding(state: BindingState, event: BindingEvent): BindingTransition {
  if (state.status === "closed") return { state, effects: [] }
  const reason = closeReason(state, event)

  if (reason) return close(state, reason, event.type === "client.closed" || reason === "browser.pane.missing")

  if (event.type === "control.unrecognized")
    return {
      state,
      effects: [{ type: "warn", message: "Ignored an unrecognized browser control event", detail: event.controlType }],
    }

  if (state.status === "attached") return transitionAttached(state, event)

  if (event.type !== "server.attached") return { state, effects: [] }

  const next = publish({
    ...state,
    status: "attached",
    fileRoots: event.fileRoots,
    requests: new Map(),
    published: undefined,
  })

  return { state: next.state, effects: [{ type: "resolve-register", binding: state.binding }, ...next.effects] }
}

function closeReason(state: ActiveBinding, event: BindingEvent): PaneCloseReason | undefined {
  if (event.type === "handshake.unsupported") return "browser.pane.unsupported"

  if (event.type === "owner.closed" || event.type === "client.closed") return "browser.pane.registration.closed"

  if (event.type === "pane.disposed") return "browser.pane.suspended"

  if (event.type === "register.timed-out")
    return state.status === "connecting" ? "browser.pane.registration.closed" : undefined

  if (event.type !== "attachment.ended") return undefined

  if (event.outcome === "replaced") return "browser.pane.replaced"

  if (event.outcome === "missing") return "browser.pane.missing"

  if (event.outcome === "unsupported") return "browser.pane.unsupported"

  // A server that drops an attachment it accepted, as on idle eviction, suspends it; one that never accepted it has no
  // browser plugin.
  if (event.outcome === "unavailable")
    return state.status === "attached" ? "browser.pane.suspended" : "browser.pane.unsupported"

  return "browser.pane.registration.closed"
}

function close(state: ActiveBinding, reason: PaneCloseReason, forget: boolean): BindingTransition {
  const requestIDs = state.status === "attached" ? Array.from(state.requests.keys()) : []
  const attempts = Array.from(state.tabs.values()).flatMap((slot) => (slot.status === "live" ? [slot.attempt] : []))
  const effects: PaneEffect[] = []

  if (forget) effects.push({ type: "remove-restore", storageKey: state.storageKey })

  if (requestIDs.length) effects.push({ type: "abort-requests", binding: state.binding, requestIDs })
  // A suspended binding hands its tabs to the window, which keeps them until it registers again.
  effects.push({
    type: "emit",
    binding: state.binding,
    event: {
      type: "state",
      state: reason === "browser.pane.suspended" ? selectInventory(state) : null,
      error: reason,
    },
  })

  if (attempts.length) effects.push({ type: "release-pages", binding: state.binding, attempts })
  effects.push({ type: "teardown", binding: state.binding })

  return { state: { status: "closed", binding: state.binding, reason }, effects }
}

function transitionAttached(state: AttachedBinding, event: BindingEvent): BindingTransition {
  if (event.type === "request.started") {
    if (state.requests.has(event.requestID)) return { state, effects: [] }

    return { state: { ...state, requests: new Map(state.requests).set(event.requestID, undefined) }, effects: [] }
  }

  if (event.type === "request.targeted") {
    if (!state.requests.has(event.requestID)) return { state, effects: [] }

    return { state: { ...state, requests: new Map(state.requests).set(event.requestID, event.tabID) }, effects: [] }
  }

  if (event.type === "request.cancelled" || event.type === "request.finished") {
    if (!state.requests.has(event.requestID)) return { state, effects: [] }
    const requests = new Map(state.requests)
    requests.delete(event.requestID)

    return {
      state: { ...state, requests },
      effects:
        event.type === "request.cancelled"
          ? [{ type: "abort-requests", binding: state.binding, requestIDs: [event.requestID] }]
          : [],
    }
  }

  if (event.type === "tab.focused") {
    if (!state.tabs.has(event.tabID)) return { state, effects: [] }
    const next = publish({ ...state, focusedTabID: event.tabID })

    return {
      state: next.state,
      effects: [
        ...next.effects,
        { type: "emit", binding: state.binding, event: { type: "focus", tabID: event.tabID } },
      ],
    }
  }

  if (event.type === "tab.opened") {
    if (event.attempt !== state.nextAttempt || state.tabs.get(event.tabID)?.status === "live")
      return { state, effects: [] }

    return {
      state: {
        ...state,
        tabs: new Map(state.tabs).set(event.tabID, {
          status: "live",
          attempt: event.attempt,
          tab: event.tab,
          url: event.tab.url,
        }),
        nextAttempt: event.attempt + 1,
      },
      effects: [],
    }
  }

  if (event.type === "tab.closed") {
    const closed = state.tabs.get(event.tabID)

    if (!closed) return { state, effects: [] }
    const tabs = new Map(state.tabs)
    tabs.delete(event.tabID)
    const focusedTabID = state.focusedTabID === event.tabID ? (tabs.keys().next().value ?? null) : state.focusedTabID

    return withoutTab({ ...state, tabs, focusedTabID }, event.tabID, closed, undefined)
  }

  if (event.type !== "tab.published" && event.type !== "tab.crashed") return { state, effects: [] }
  const slot = state.tabs.get(event.tabID)

  if (slot?.status !== "live" || slot.attempt !== event.attempt) return { state, effects: [] }

  if (event.type === "tab.published") {
    const tabs = new Map(state.tabs).set(event.tabID, { ...slot, tab: event.tab, url: event.tab.url || slot.url })

    return publish({ ...state, tabs }, event.error)
  }

  // A crashed page keeps its tab, unloaded, so showing it or an agent command on it loads its address again.
  const latest = event.tab ?? slot.tab

  const tabs = new Map(state.tabs).set(event.tabID, {
    status: "unloaded",
    tab: {
      id: event.tabID,
      url: latest.url || slot.url || "about:blank",
      title: latest.title,
      loading: false,
      loadError: "page_crashed",
      canGoBack: false,
      canGoForward: false,
      // The next page's first navigation takes this generation.
      generation: latest.generation + 1,
    },
  })

  return withoutTab({ ...state, tabs }, event.tabID, slot, "page_crashed")
}

/** Aborts the requests that target a tab whose page went away, releases that page, and publishes the result. */
function withoutTab(state: AttachedBinding, tabID: Browser.TabID, slot: TabSlot, error: string | undefined) {
  const targeting = Array.from(state.requests).flatMap(([requestID, target]) => (target === tabID ? [requestID] : []))
  const requests = new Map(state.requests)
  targeting.forEach((requestID) => requests.delete(requestID))
  const next = publish({ ...state, requests }, error)
  const effects: PaneEffect[] = []

  if (targeting.length) effects.push({ type: "abort-requests", binding: state.binding, requestIDs: targeting })

  if (slot.status === "live") effects.push({ type: "release-pages", binding: state.binding, attempts: [slot.attempt] })

  return { state: next.state, effects: [...effects, ...next.effects] }
}

/** Saves the tabs for the next launch, and reports the state unless it repeats the last one reported. */
function publish(state: AttachedBinding, error?: string): AttachedTransition {
  const inventory = selectInventory(state)

  const event =
    error === undefined
      ? { type: "state" as const, state: inventory }
      : { type: "state" as const, state: inventory, error }

  const published = JSON.stringify(event)

  const save: PaneEffect = {
    type: "save-restore",
    storageKey: state.storageKey,
    snapshot: {
      tabs: Array.from(state.tabs.values(), (slot) => ({
        id: slot.tab.id,
        // A page can publish before Chromium assigns its URL.
        url: slot.tab.url || (slot.status === "live" ? slot.url : "") || "about:blank",
      })),
      focusedTabID: state.focusedTabID,
    },
  }

  if (published === state.published) return { state, effects: [save] }

  return { state: { ...state, published }, effects: [save, { type: "report", binding: state.binding, event }] }
}

function createConnecting(event: Extract<PaneMachineEvent, { readonly type: "registered" }>): ActiveBinding {
  const restore = event.restore ?? {
    tabs: event.saved.tabs.map((tab) => ({
      id: tab.id,
      url: tab.url,
      title: "",
      loading: false,
      canGoBack: false,
      canGoForward: false,
      generation: 0,
    })),
    focusedTabID: event.saved.focusedTabID,
  }

  const tabs = new Map(
    restore.tabs.map((tab): [Browser.TabID, TabSlot] => [
      tab.id,
      {
        status: "unloaded",
        // A restored page's first navigation takes the next generation.
        tab: { ...tab, loading: false, canGoBack: false, canGoForward: false, generation: tab.generation + 1 },
      },
    ]),
  )

  return {
    status: "connecting",
    binding: event.binding,
    window: event.window,
    storageKey: event.storageKey,
    tabs,
    focusedTabID:
      restore.focusedTabID !== null && tabs.has(restore.focusedTabID)
        ? restore.focusedTabID
        : (tabs.keys().next().value ?? null),
    nextAttempt: 1,
  }
}

export function isPaneDisposed(state: PaneState) {
  return state.status === "disposed"
}

export function selectBinding(state: PaneState, binding: string) {
  return state.status === "active" ? state.bindings.get(binding) : undefined
}

/** The binding when `window` registered it. */
export function selectOwnedBinding(state: PaneState, window: number, binding: string) {
  const entry = selectBinding(state, binding)

  return entry?.window === window ? entry : undefined
}

export function selectFileRoots(state: PaneState, binding: string): readonly string[] {
  const entry = selectBinding(state, binding)

  return entry?.status === "attached" ? entry.fileRoots : []
}

export function selectInventory(entry: ActiveBinding): Browser.State {
  return { tabs: Array.from(entry.tabs.values(), (slot) => slot.tab), focusedTabID: entry.focusedTabID }
}

export function selectTabSlot(state: PaneState, binding: string, tabID: Browser.TabID) {
  const entry = selectBinding(state, binding)

  return entry?.status === "attached" ? entry.tabs.get(tabID) : undefined
}

/** The attempt of the tab's current page, if it has one. */
export function selectPageAttempt(state: PaneState, binding: string, tabID: Browser.TabID) {
  const slot = selectTabSlot(state, binding, tabID)

  return slot?.status === "live" ? slot.attempt : undefined
}

export function isCurrentPage(state: PaneState, binding: string, tabID: Browser.TabID, attempt: number) {
  return selectPageAttempt(state, binding, tabID) === attempt
}

export function isFocusedPage(state: PaneState, binding: string, tabID: Browser.TabID, attempt: number) {
  return isCurrentPage(state, binding, tabID, attempt) && selectBinding(state, binding)?.focusedTabID === tabID
}
