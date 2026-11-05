import type { Browser } from "@opencode/plugin-browser/rpc"

/** How long a registration waits for main's answer, above main's own 15 s attach timeout. */
export const REGISTER_TIMEOUT_MS = 20_000

export const RETRY_BASE_MS = 1_000

export const RETRY_MAX_MS = 30_000

/** The pane's main-process Ipc: running in a generation, starting or restarting, or gone. */
export type Ipc =
  | { readonly status: "active"; readonly generation: number }
  | { readonly status: "pending" }
  | { readonly status: "inactive" }

/**
 * One session's native binding. `attempt` names the current binding (`registering`, `ready`) or retry timer
 * (`backoff`), so results of a superseded one are ignored. `attempts` counts registrations that failed in a row, which
 * sets the backoff.
 * - `idle`: nothing asked for the pane yet, e.g. the server is still creating the session.
 * - `registering`: a binding waits for main to take it.
 * - `ready`: main took the binding.
 * - `backoff`: main closed or refused the binding; a timer registers again.
 * - `suspended`: the tabs stay without a binding. `idle`: the server evicted it, and a user or agent wakes it. `ipc`:
 *   the pane's Ipc is gone, and it registers again once the Ipc is back.
 * - `blocked`: another window took the session (`replaced`), or the server lacks it (`missing`).
 */
export type Phase =
  | { readonly status: "idle" }
  | { readonly status: "registering"; readonly attempt: number; readonly attempts: number }
  | { readonly status: "ready"; readonly attempt: number }
  | { readonly status: "backoff"; readonly attempt: number; readonly attempts: number }
  | { readonly status: "suspended"; readonly reason: "idle" | "ipc" }
  | { readonly status: "blocked"; readonly reason: "replaced" | "missing" }

/** How the session's side-panel strip follows the desktop's tab inventory. */
export type Strip = {
  /** The session's location is known, so the strip can be written. */
  readonly located: boolean
  /** Tab IDs of the last inventory the strip received, to tell new tabs from ones the user just closed. */
  readonly mirrored: readonly Browser.TabID[]
  /** A native inventory arrived while the strip could not be written; the next sync prunes with it. */
  readonly prune: boolean
  /** A tab main asked to select while the strip could not be written. */
  readonly focus: Browser.TabID | undefined
}

/**
 * The address field focus a user's new blank tab asks for.
 * - `opening`: the tab is requested; `known` are the tabs before it, and `settled` is true once the command answered.
 * - `ready`: the new blank tab; its pane focuses the address field once it shows it.
 */
export type AddressFocus =
  | { readonly status: "none" }
  | {
      readonly status: "opening"
      readonly request: number
      readonly known: readonly Browser.TabID[]
      readonly settled: boolean
    }
  | { readonly status: "ready"; readonly tabID: Browser.TabID }

export type Attachment = {
  readonly serverID: string
  readonly phase: Phase
  /** The desktop's tab inventory, kept while suspended or retrying so a new binding restores it. */
  readonly browser: Browser.State | null
  /** Host embed per tab page of the current binding. */
  readonly embeds: Readonly<Record<string, string | undefined>>
  /** The raw code of the last failed request or reported error, such as `browser.address.web`. */
  readonly error: string | undefined
  readonly strip: Strip
  readonly addressFocus: AddressFocus
}

/**
 * Every attachment of this window, which belongs to its shell session tab rather than the route. `issued` is the last
 * attempt or request id handed out. `unsupported` lists servers whose plugin lacks the browser RPC.
 */
export type State =
  | {
      readonly status: "open"
      readonly ipc: Ipc
      readonly issued: number
      readonly unsupported: Readonly<Record<string, true | undefined>>
      readonly sessions: Readonly<Record<string, Attachment | undefined>>
    }
  | { readonly status: "disposed" }

export type Event =
  | { readonly type: "disposed" }
  | { readonly type: "ipc.changed"; readonly ipc: Ipc }
  /** An unsupported server reconnected, restarted, or is no longer listed: it may have the browser RPC now. */
  | { readonly type: "server.changed"; readonly serverID: string }
  | {
      readonly type: "session.attached"
      readonly sessionKey: string
      readonly serverID: string
      readonly located: boolean
    }
  | { readonly type: "session.removed"; readonly sessionKeys: readonly string[] }
  | { readonly type: "session.routed"; readonly sessionKey: string | undefined }
  | { readonly type: "session.located"; readonly sessionKey: string; readonly located: boolean }
  /** A user or agent edge asks for the pane: focus, a key, the route, or a Session execution. */
  | { readonly type: "session.wake"; readonly sessionKey: string }
  /** The server finished creating the session. */
  | { readonly type: "session.created"; readonly sessionKey: string }
  | {
      readonly type: "session.command"
      readonly sessionKey: string
      readonly action: Browser.Action
      /** The user opened a blank tab, whose pane then focuses the address field. */
      readonly focusAddress: boolean
    }
  | { readonly type: "command.settled"; readonly sessionKey: string; readonly request: number }
  | {
      readonly type: "command.failed"
      readonly sessionKey: string
      /** The binding the command went through; undefined when none could take it. */
      readonly attempt: number | undefined
      readonly request: number
      readonly error: string
      /** The pane's Ipc could not answer. */
      readonly unavailable: boolean
    }
  | { readonly type: "address.focused"; readonly sessionKey: string; readonly tabID: Browser.TabID }
  | { readonly type: "register.accepted"; readonly sessionKey: string; readonly attempt: number }
  | {
      readonly type: "register.failed"
      readonly sessionKey: string
      readonly attempt: number
      /** The pane's Ipc could not answer. */
      readonly unavailable: boolean
      /** Main closed the binding it took; its closed-state event decides why. */
      readonly closed: boolean
    }
  | { readonly type: "register.timed-out"; readonly sessionKey: string; readonly attempt: number }
  | { readonly type: "retry.due"; readonly sessionKey: string; readonly attempt: number }
  | {
      readonly type: "pane.state"
      readonly sessionKey: string
      readonly attempt: number
      readonly state: Browser.State | null
      readonly error: string | undefined
    }
  | {
      readonly type: "pane.embed"
      readonly sessionKey: string
      readonly attempt: number
      readonly tabID: Browser.TabID
      readonly embed: string
    }
  | {
      readonly type: "pane.focus"
      readonly sessionKey: string
      readonly attempt: number
      readonly tabID: Browser.TabID
    }

export type MachineEffect =
  | {
      readonly type: "open-registration"
      readonly sessionKey: string
      readonly attempt: number
      readonly restore: Browser.State | undefined
    }
  | { readonly type: "close-registration"; readonly sessionKey: string; readonly attempt: number }
  | {
      readonly type: "schedule-register-timeout"
      readonly sessionKey: string
      readonly attempt: number
      readonly delayMs: number
    }
  | { readonly type: "cancel-register-timeout"; readonly sessionKey: string }
  | { readonly type: "schedule-retry"; readonly sessionKey: string; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "cancel-retry"; readonly sessionKey: string }
  | {
      readonly type: "send-command"
      readonly sessionKey: string
      readonly attempt: number
      readonly request: number
      readonly action: Browser.Action
    }
  | {
      readonly type: "reject-command"
      readonly sessionKey: string
      readonly request: number
      readonly error: string
      readonly unavailable: boolean
    }
  /**
   * Applies an inventory to the strip: closes stored tabs `keep` lacks (only a native inventory prunes, so the desktop
   * decides which tabs exist), then appends `open`, the tabs new since the last mirrored inventory.
   */
  | {
      readonly type: "sync-strip"
      readonly sessionKey: string
      readonly keep: readonly Browser.TabID[] | undefined
      readonly open: readonly Browser.TabID[]
    }
  | { readonly type: "focus-strip-tab"; readonly sessionKey: string; readonly tabID: Browser.TabID }
  /** Records the session's loaded pages in the browser history. */
  | { readonly type: "record-history"; readonly sessionKey: string }
  /** The session is no longer attached: drop its per-session resources. */
  | { readonly type: "detach"; readonly sessionKey: string }
  | { readonly type: "watch-server"; readonly serverID: string }
  | { readonly type: "unwatch-server"; readonly serverID: string }

export type Transition = { readonly state: State; readonly effects: readonly MachineEffect[] }

/** The fields of a session ref the selectors read. */
export type Target = {
  readonly key: string
  readonly pending: boolean
  readonly server: { readonly id: string; readonly compatible: boolean }
}

type Open = Extract<State, { status: "open" }>

type Bound = Extract<Phase, { status: "registering" | "ready" }>

type SessionEvent = Exclude<
  Event,
  { type: "disposed" | "ipc.changed" | "server.changed" | "session.attached" | "session.removed" | "session.routed" }
>

const DISPOSED: State = { status: "disposed" }

const NO_FOCUS: AddressFocus = { status: "none" }

const SUSPENDED_IPC: Phase = { status: "suspended", reason: "ipc" }

const NO_TABS: readonly Browser.TabID[] = []

export function createInitialState(ipc: Ipc): State {
  return { status: "open", ipc, issued: 0, unsupported: {}, sessions: {} }
}

export function transition(state: State, event: Event): Transition {
  if (state.status === "disposed") return { state, effects: [] }

  if (event.type === "disposed") return dispose(state)

  if (event.type === "ipc.changed") return ipcChanged(state, event.ipc)

  if (event.type === "server.changed") return serverChanged(state, event.serverID)

  if (event.type === "session.attached") return attached(state, event)

  if (event.type === "session.removed") return removed(state, event.sessionKeys)

  if (event.type === "session.routed") return routed(state, event.sessionKey)
  const attachment = state.sessions[event.sessionKey]

  if (!attachment) return { state, effects: [] }

  return session(state, event.sessionKey, attachment, event)
}

export function serverSupported(state: State, serverID: string) {
  return state.status === "open" && !state.unsupported[serverID]
}

function attachmentOf(state: State, sessionKey: string) {
  return state.status === "open" ? state.sessions[sessionKey] : undefined
}

/** The desktop answered with an inventory, or took the binding. */
export function sessionAttached(state: State, sessionKey: string) {
  const attachment = attachmentOf(state, sessionKey)

  return !!attachment && (attachment.phase.status === "ready" || attachment.browser !== null)
}

/**
 * The desktop has not answered with its first inventory yet: the routed session is about to attach, it registered and
 * waits, or it waits for the pane's Ipc to start.
 */
export function sessionPending(state: State, target: Target) {
  if (state.status === "disposed") return false
  const attachment = state.sessions[target.key]

  if (!attachment) return !state.unsupported[target.server.id] && target.server.compatible && !target.pending

  if (attachment.browser || attachment.error) return false
  const phase = attachment.phase

  return (
    phase.status === "registering" ||
    phase.status === "ready" ||
    (phase.status === "suspended" && phase.reason === "ipc" && state.ipc.status === "pending")
  )
}

/**
 * Tab IDs to list in the side panel: the desktop's inventory, limited to tabs stored in the strip. Until the first
 * inventory arrives, the stored tabs, so a restored selection holds; that inventory then prunes the ones it lacks.
 */
export function sessionTabs(state: State, target: Target, open: readonly string[]) {
  if (sessionPending(state, target)) return open

  if (!sessionAttached(state, target.key)) return []

  return attachmentOf(state, target.key)?.browser?.tabs.flatMap((tab) => (open.includes(tab.id) ? [tab.id] : [])) ?? []
}

export function sessionBrowser(state: State, sessionKey: string) {
  return attachmentOf(state, sessionKey)?.browser ?? null
}

export function sessionTab(state: State, sessionKey: string, tabID: string) {
  return sessionBrowser(state, sessionKey)?.tabs.find((tab) => tab.id === tabID)
}

export function sessionSuspended(state: State, sessionKey: string) {
  return attachmentOf(state, sessionKey)?.phase.status === "suspended"
}

export function sessionError(state: State, sessionKey: string) {
  return attachmentOf(state, sessionKey)?.error
}

export function sessionEmbed(state: State, sessionKey: string, tabID: string) {
  return attachmentOf(state, sessionKey)?.embeds[tabID]
}

/** The current binding's attempt; a new one, e.g. after a suspension, has no pages for restored tabs yet. */
export function sessionRegistration(state: State, sessionKey: string) {
  const phase = attachmentOf(state, sessionKey)?.phase

  return phase?.status === "registering" || phase?.status === "ready" ? phase.attempt : undefined
}

/** The blank tab the user just opened, whose pane focuses the address field once it shows it. */
export function addressFocusTab(state: State, sessionKey: string) {
  const focus = attachmentOf(state, sessionKey)?.addressFocus

  return focus?.status === "ready" ? focus.tabID : undefined
}

function dispose(state: Open): Transition {
  return {
    state: DISPOSED,
    effects: [
      ...listed(state.sessions).flatMap(([key, attachment]) => [...stop(key, attachment.phase), detach(key)]),
      ...Object.keys(state.unsupported).map((serverID): MachineEffect => ({ type: "unwatch-server", serverID })),
    ],
  }
}

// The pane's Ipc goes away while its main plugin reloads or is not active, taking every binding with it. Each
// attachment keeps its tabs and registers again once the Ipc is back, without a retry timer.
function ipcChanged(state: Open, ipc: Ipc): Transition {
  const previous = state.ipc

  if (
    previous.status === ipc.status &&
    (previous.status !== "active" || ipc.status !== "active" || previous.generation === ipc.generation)
  )
    return { state, effects: [] }
  const restarted = previous.status === "active"

  return listed(state.sessions).reduce<Transition & { state: Open }>(
    (result, [key, attachment]) => {
      const phase = attachment.phase
      const bound = phase.status === "registering" || phase.status === "ready" || phase.status === "backoff"
      const lost = phase.status === "suspended" && phase.reason === "ipc"

      if (ipc.status !== "active") {
        if (!bound) return result

        return put(result.state, key, suspend(attachment, "ipc"), [...result.effects, ...stop(key, phase)])
      }

      if (!lost && !(restarted && bound)) return result
      const attempt = result.state.issued + 1

      return put(
        result.state,
        key,
        { ...attachment, phase: { status: "registering", attempt, attempts: 0 }, embeds: {}, error: undefined },
        [...result.effects, ...stop(key, phase), ...register(key, attempt, attachment.browser)],
        attempt,
      )
    },
    { state: { ...state, ipc }, effects: [] },
  )
}

function serverChanged(state: Open, serverID: string): Transition {
  if (!state.unsupported[serverID]) return { state, effects: [] }

  return {
    state: {
      ...state,
      unsupported: Object.fromEntries(Object.entries(state.unsupported).filter((entry) => entry[0] !== serverID)),
    },
    effects: [{ type: "unwatch-server", serverID }],
  }
}

function attached(state: Open, event: Extract<Event, { type: "session.attached" }>): Transition {
  if (state.unsupported[event.serverID] || state.sessions[event.sessionKey]) return { state, effects: [] }

  return put(state, event.sessionKey, {
    serverID: event.serverID,
    phase: { status: "idle" },
    browser: null,
    embeds: {},
    error: undefined,
    strip: { located: event.located, mirrored: NO_TABS, prune: false, focus: undefined },
    addressFocus: NO_FOCUS,
  })
}

function removed(state: Open, sessionKeys: readonly string[]): Transition {
  const gone = listed(state.sessions).filter((entry) => sessionKeys.includes(entry[0]))

  if (gone.length === 0) return { state, effects: [] }

  return {
    state: {
      ...state,
      sessions: Object.fromEntries(listed(state.sessions).filter((entry) => !sessionKeys.includes(entry[0]))),
    },
    effects: gone.flatMap(([key, attachment]) => [...stop(key, attachment.phase), detach(key)]),
  }
}

// A blank tab the user opened in one session must not take the address focus when another session shows a blank tab.
function routed(state: Open, sessionKey: string | undefined): Transition {
  const reset = listed(state.sessions).filter(
    ([key, attachment]) => key !== sessionKey && attachment.addressFocus.status !== "none",
  )

  if (reset.length === 0) return { state, effects: [] }

  return {
    state: {
      ...state,
      sessions: {
        ...state.sessions,
        ...Object.fromEntries(reset.map(([key, attachment]) => [key, { ...attachment, addressFocus: NO_FOCUS }])),
      },
    },
    effects: [],
  }
}

function session(state: Open, key: string, attachment: Attachment, event: SessionEvent): Transition {
  const phase = attachment.phase

  switch (event.type) {
    case "session.located":
      return located(state, key, attachment, event.located)
    case "session.wake":
      return wake(state, key, attachment, false)
    case "session.created":
      return wake(state, key, attachment, true)
    case "session.command":
      return command(state, key, attachment, event)
    case "command.settled": {
      const focus = attachment.addressFocus

      if (focus.status !== "opening" || focus.request !== event.request) return { state, effects: [] }

      return put(state, key, { ...attachment, addressFocus: { ...focus, settled: true } })
    }

    case "command.failed":
      return commandFailed(state, key, attachment, event)
    case "address.focused": {
      if (attachment.addressFocus.status !== "ready" || attachment.addressFocus.tabID !== event.tabID)
        return { state, effects: [] }

      return put(state, key, { ...attachment, addressFocus: NO_FOCUS })
    }

    case "register.accepted": {
      if (phase.status !== "registering" || phase.attempt !== event.attempt) return { state, effects: [] }

      return put(state, key, { ...attachment, phase: { status: "ready", attempt: phase.attempt } }, [
        { type: "cancel-register-timeout", sessionKey: key },
      ])
    }

    case "register.failed": {
      if (phase.status !== "registering" || phase.attempt !== event.attempt) return { state, effects: [] }

      if (event.unavailable) return put(state, key, suspend(attachment, "ipc"), stop(key, phase))

      // Main closed a binding it took; its closed-state event decides, and the register timeout bounds the wait.
      if (event.closed) return { state, effects: [] }

      return backoff(state, key, attachment, phase)
    }

    case "register.timed-out": {
      if (phase.status !== "registering" || phase.attempt !== event.attempt) return { state, effects: [] }

      return backoff(state, key, attachment, phase)
    }

    case "retry.due": {
      if (phase.status !== "backoff" || phase.attempt !== event.attempt) return { state, effects: [] }

      if (state.ipc.status !== "active") return put(state, key, suspend(attachment, "ipc"))
      const attempt = state.issued + 1

      return put(
        state,
        key,
        {
          ...attachment,
          phase: { status: "registering", attempt, attempts: phase.attempts },
          embeds: {},
          error: undefined,
        },
        register(key, attempt, attachment.browser),
        attempt,
      )
    }

    case "pane.state":
      return paneState(state, key, attachment, event)
    case "pane.embed": {
      if (!current(phase, event.attempt) || attachment.embeds[event.tabID] === event.embed)
        return { state, effects: [] }

      return put(state, key, { ...attachment, embeds: { ...attachment.embeds, [event.tabID]: event.embed } })
    }

    case "pane.focus": {
      if (!current(phase, event.attempt)) return { state, effects: [] }

      // Focus requests write to the owning session's strip even while another shell tab is routed, so the side panel
      // and browser tab are already selected when the user returns to it.
      if (attachment.strip.located)
        return { state, effects: [{ type: "focus-strip-tab", sessionKey: key, tabID: event.tabID }] }

      return put(state, key, { ...attachment, strip: { ...attachment.strip, focus: event.tabID } })
    }
  }
}

// Writes held while the session's location was unknown land once the server reports it. A held focus lands only for
// a tab the desktop still has.
function located(state: Open, key: string, attachment: Attachment, value: boolean): Transition {
  const strip = attachment.strip

  if (strip.located === value) return { state, effects: [] }

  if (!value) return put(state, key, { ...attachment, strip: { ...strip, located: false } })
  const ids = attachment.browser?.tabs.map((tab) => tab.id)
  const focus = strip.focus

  return put(
    state,
    key,
    { ...attachment, strip: { located: true, mirrored: ids ?? NO_TABS, prune: false, focus: undefined } },
    [
      ...(ids ? sync(key, ids, strip.mirrored, strip.prune) : []),
      ...(focus && ids?.includes(focus) ? [{ type: "focus-strip-tab" as const, sessionKey: key, tabID: focus }] : []),
    ],
  )
}

// Passive edges wake an idle or suspended pane without bypassing transport backoff or duplicating a binding. Only the
// server creating the session lifts `missing`; nothing lifts `replaced` but the user's next session visit elsewhere.
function wake(state: Open, key: string, attachment: Attachment, created: boolean): Transition {
  const phase = attachment.phase

  if (phase.status === "registering" || phase.status === "ready" || phase.status === "backoff")
    return { state, effects: [] }

  if (phase.status === "blocked" && (phase.reason === "replaced" || !created)) return { state, effects: [] }

  if (state.ipc.status !== "active") {
    if (phase.status === "suspended" && phase.reason === "ipc") return { state, effects: [] }

    return put(state, key, suspend(attachment, "ipc"))
  }

  const attempt = state.issued + 1
  const restore = phase.status === "blocked" ? null : attachment.browser

  return put(
    state,
    key,
    { ...attachment, phase: { status: "registering", attempt, attempts: 0 }, embeds: {}, error: undefined },
    register(key, attempt, restore),
    attempt,
  )
}

// A command wakes its attachment once and is never replayed. Backoff and blocked bindings answer at once without
// registering, so repeated commands cannot bypass the retry timer.
function command(
  state: Open,
  key: string,
  attachment: Attachment,
  event: Extract<Event, { type: "session.command" }>,
): Transition {
  const phase = attachment.phase
  const request = state.issued + 1

  const focus: AddressFocus = event.focusAddress
    ? { status: "opening", request, known: attachment.browser?.tabs.map((tab) => tab.id) ?? NO_TABS, settled: false }
    : attachment.addressFocus

  if (phase.status === "registering" || phase.status === "ready")
    return put(
      state,
      key,
      { ...attachment, error: undefined, addressFocus: focus },
      [{ type: "send-command", sessionKey: key, attempt: phase.attempt, request, action: event.action }],
      request,
    )

  if (phase.status === "backoff" || phase.status === "blocked") {
    const error =
      phase.status === "blocked" && phase.reason === "replaced" ? "browser.pane.replaced" : "browser.pane.unavailable"

    return put(
      state,
      key,
      { ...attachment, error: undefined, addressFocus: NO_FOCUS },
      [{ type: "reject-command", sessionKey: key, request, error, unavailable: false }],
      request,
    )
  }

  // An unreachable pane is suspended, not a failed request.
  if (state.ipc.status !== "active")
    return put(
      state,
      key,
      { ...suspend(attachment, "ipc"), addressFocus: NO_FOCUS },
      [{ type: "reject-command", sessionKey: key, request, error: "browser.pane.unavailable", unavailable: true }],
      request,
    )
  const attempt = request + 1

  return put(
    state,
    key,
    {
      ...attachment,
      phase: { status: "registering", attempt, attempts: 0 },
      embeds: {},
      error: undefined,
      addressFocus: focus,
    },
    [
      ...register(key, attempt, attachment.browser),
      { type: "send-command", sessionKey: key, attempt, request, action: event.action },
    ],
    attempt,
  )
}

function commandFailed(
  state: Open,
  key: string,
  attachment: Attachment,
  event: Extract<Event, { type: "command.failed" }>,
): Transition {
  // A tab that never opened has no address field to focus.
  const focus =
    attachment.addressFocus.status === "opening" && attachment.addressFocus.request === event.request
      ? NO_FOCUS
      : attachment.addressFocus

  if (event.unavailable) {
    const phase = event.attempt === undefined ? undefined : current(attachment.phase, event.attempt)

    if (phase) return put(state, key, suspend(attachment, "ipc"), stop(key, phase))

    if (focus === attachment.addressFocus) return { state, effects: [] }

    return put(state, key, { ...attachment, addressFocus: focus })
  }

  const replaced = attachment.phase.status === "blocked" && attachment.phase.reason === "replaced"

  return put(state, key, {
    ...attachment,
    error: replaced ? "browser.pane.replaced" : event.error,
    addressFocus: focus,
  })
}

function paneState(
  state: Open,
  key: string,
  attachment: Attachment,
  event: Extract<Event, { type: "pane.state" }>,
): Transition {
  const phase = current(attachment.phase, event.attempt)

  if (!phase) return { state, effects: [] }

  // The server's plugin lacks the browser RPC: every session on it stops until the server changes.
  if (event.error === "browser.pane.unsupported") {
    const serverID = attachment.serverID
    const gone = listed(state.sessions).filter((entry) => entry[1].serverID === serverID)

    return {
      state: {
        ...state,
        unsupported: { ...state.unsupported, [serverID]: true },
        sessions: Object.fromEntries(listed(state.sessions).filter((entry) => entry[1].serverID !== serverID)),
      },
      effects: [
        ...gone.flatMap(([item, value]) => [...stop(item, value.phase), detach(item)]),
        { type: "watch-server", serverID },
      ],
    }
  }

  if (event.error === "browser.pane.replaced" || event.error === "browser.pane.missing") {
    const replaced = event.error === "browser.pane.replaced"

    return put(
      state,
      key,
      {
        ...attachment,
        phase: { status: "blocked", reason: replaced ? "replaced" : "missing" },
        browser: null,
        embeds: {},
        error: replaced ? event.error : undefined,
        strip: { located: attachment.strip.located, mirrored: NO_TABS, prune: false, focus: undefined },
        addressFocus: NO_FOCUS,
      },
      stop(key, phase),
    )
  }

  // Main closed the binding, or never took it. Keep the tabs and register again with backoff.
  if (event.error === "browser.pane.registration.closed") return backoff(state, key, attachment, phase)

  // Idle eviction has no retry timer: a user or Session execution wakes it on demand.
  if (event.error === "browser.pane.suspended") {
    const browser = event.state ?? attachment.browser
    const mirrored = event.state ? mirror(key, attachment.strip, browser, false) : undefined

    return put(state, key, { ...suspend(attachment, "idle", browser), strip: mirrored?.strip ?? attachment.strip }, [
      ...stop(key, phase),
      ...(mirrored?.effects ?? []),
    ])
  }

  const mirrored = mirror(key, attachment.strip, event.state, true)

  return put(
    state,
    key,
    {
      ...attachment,
      phase: { status: "ready", attempt: phase.attempt },
      browser: event.state,
      error: event.error,
      strip: mirrored.strip,
      addressFocus: follow(attachment.addressFocus, event.state),
    },
    [
      ...(phase.status === "registering" ? [{ type: "cancel-register-timeout" as const, sessionKey: key }] : []),
      ...mirrored.effects,
      ...(event.state ? [{ type: "record-history" as const, sessionKey: key }] : []),
    ],
  )
}

function backoff(state: Open, key: string, attachment: Attachment, phase: Bound): Transition {
  const prior = phase.status === "registering" ? phase.attempts : 0
  const attempt = state.issued + 1

  return put(
    state,
    key,
    {
      ...attachment,
      phase: { status: "backoff", attempt, attempts: prior + 1 },
      embeds: {},
      error: undefined,
      addressFocus: NO_FOCUS,
    },
    [
      ...stop(key, phase),
      {
        type: "schedule-retry",
        sessionKey: key,
        attempt,
        delayMs: Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** prior),
      },
    ],
    attempt,
  )
}

// Mirrors an inventory into the strip. Only tabs new since the last mirrored inventory are added, so a tab the user
// just closed is not reopened before the desktop confirms. Only a native inventory prunes; suspended and restoring
// states keep the tabs they will restore. While the strip cannot be written, the prune waits for the location.
function mirror(key: string, strip: Strip, browser: Browser.State | null, native: boolean) {
  if (!browser)
    return { strip: { located: strip.located, mirrored: NO_TABS, prune: false, focus: undefined }, effects: [] }
  const ids = browser.tabs.map((tab) => tab.id)

  if (!strip.located)
    return {
      strip: {
        ...strip,
        prune: strip.prune || native,
        focus: strip.focus && ids.includes(strip.focus) ? strip.focus : undefined,
      },
      effects: [],
    }

  return { strip: { ...strip, mirrored: ids }, effects: sync(key, ids, strip.mirrored, native) }
}

function sync(
  key: string,
  ids: readonly Browser.TabID[],
  mirrored: readonly Browser.TabID[],
  prune: boolean,
): MachineEffect[] {
  const open = ids.filter((id) => !mirrored.includes(id))

  if (!prune && open.length === 0) return []

  return [{ type: "sync-strip", sessionKey: key, keep: prune ? ids : undefined, open }]
}

// The new tab a user's tabs.open added: blank, it takes the address focus; anything else ends the request. A ready tab
// keeps it until it navigates or closes.
function follow(focus: AddressFocus, browser: Browser.State | null): AddressFocus {
  if (focus.status === "none") return focus
  const tabs = browser?.tabs ?? []

  if (focus.status === "ready") {
    const tab = tabs.find((item) => item.id === focus.tabID)

    return tab && blank(tab) ? focus : NO_FOCUS
  }

  const added = tabs.filter((tab) => !focus.known.includes(tab.id))

  if (added.length === 0) return focus.settled ? NO_FOCUS : focus
  const opened = added.find(blank)

  return opened ? { status: "ready", tabID: opened.id } : NO_FOCUS
}

function blank(tab: Browser.Tab) {
  return !tab.url || tab.url === "about:blank"
}

function suspend(attachment: Attachment, reason: "idle" | "ipc", browser = attachment.browser): Attachment {
  return {
    ...attachment,
    phase: reason === "ipc" ? SUSPENDED_IPC : { status: "suspended", reason },
    browser,
    embeds: {},
    error: undefined,
    addressFocus: NO_FOCUS,
  }
}

function current(phase: Phase, attempt: number) {
  return (phase.status === "registering" || phase.status === "ready") && phase.attempt === attempt ? phase : undefined
}

function register(key: string, attempt: number, browser: Browser.State | null): MachineEffect[] {
  return [
    { type: "open-registration", sessionKey: key, attempt, restore: browser ?? undefined },
    { type: "schedule-register-timeout", sessionKey: key, attempt, delayMs: REGISTER_TIMEOUT_MS },
  ]
}

function stop(key: string, phase: Phase): MachineEffect[] {
  if (phase.status === "registering")
    return [
      { type: "cancel-register-timeout", sessionKey: key },
      { type: "close-registration", sessionKey: key, attempt: phase.attempt },
    ]

  if (phase.status === "ready") return [{ type: "close-registration", sessionKey: key, attempt: phase.attempt }]

  if (phase.status === "backoff") return [{ type: "cancel-retry", sessionKey: key }]

  return []
}

function detach(key: string): MachineEffect {
  return { type: "detach", sessionKey: key }
}

function put(
  state: Open,
  key: string,
  attachment: Attachment,
  effects: readonly MachineEffect[] = [],
  issued = state.issued,
) {
  return { state: { ...state, issued, sessions: { ...state.sessions, [key]: attachment } }, effects }
}

function listed(sessions: Open["sessions"]) {
  return Object.entries(sessions).filter((entry): entry is [string, Attachment] => entry[1] !== undefined)
}
