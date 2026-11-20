import type { Browser } from "@opencode/plugin-browser/rpc"

/** How long a registration waits for main's answer, above main's own 15 s attach timeout. */
export const REGISTER_TIMEOUT_MS = 20_000

export const RETRY_BASE_MS = 1_000

export const RETRY_MAX_MS = 30_000

/**
 * How many registrations may fail in a row while a pane with nothing to show yet still counts as on its way. Past
 * that the retries go on, and the pane says the browser could not open.
 */
export const PENDING_RETRIES = 4

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
  | { readonly status: "suspended"; readonly reason: "idle" | "ipc" | "unlisted" }
  | { readonly status: "blocked"; readonly reason: "replaced" | "missing" | "unsupported" }

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
  /**
   * Saved tabs the person closed in the strip before an inventory named them. The first native inventory that has one
   * closes it on the desktop, and the strip does not take it back.
   */
  readonly dismissed: readonly string[]
  /**
   * The saved tab the person selected in the strip before an inventory named it, not the one the strip mounted with.
   * The first native inventory that has it, with another tab in front, brings it to the front on the desktop too.
   */
  readonly selected: string | undefined
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

/**
 * Something that did not work: the raw `code`, such as `browser.address.web`, and the command the person attempted,
 * which is undefined when main reported the error by itself. `id` tells one failure from the next with the same code.
 */
export type Failure = {
  readonly id: number
  readonly code: string
  readonly action: Browser.Action | undefined
}

export type Attachment = {
  readonly serverID: string
  readonly phase: Phase
  /** The desktop's tab inventory, kept while suspended or retrying so a new binding restores it. */
  readonly browser: Browser.State | null
  /** Host embed per tab page of the current binding. */
  readonly embeds: Readonly<Record<string, string | undefined>>
  /**
   * The last failed command or the last error main reported, until the person's next command, their dismissal or a
   * newer one. A healthy inventory keeps it: the person may not have read it yet.
   */
  readonly failure: Failure | undefined
  readonly strip: Strip
  readonly addressFocus: AddressFocus
  /**
   * `dismissed`: the person closed the pane during a run in which it had shown the agent's page (`shown`), so nothing
   * opens it again until the run ends, their next queued prompt starts, or they open it themselves.
   */
  readonly side: "unobserved" | "open" | "closed" | "dismissed"
  /**
   * The pane has shown the agent's page in this run: a show request opened or took the pane, or the agent worked in
   * the tab the open pane showed. Closing a pane that showed none of that says nothing about the agent's pages.
   */
  readonly shown: boolean
  /**
   * What an agent's activity asked of the pane, kept while it cannot be decided: the strip cannot be written yet, or
   * the inventory that carries the tab has not arrived. It holds only what was asked. Once both are there, the driver
   * asks again with what is true then (`present-held`), so it is decided as a request that arrives at that moment is.
   * A newer request replaces it, and it is dropped, not applied, when the person acts first, the run ends, the tab
   * closes, the session leaves the screen, its binding is superseded, or `HELD_REQUEST_TTL_MS` passes.
   */
  readonly held?: Held
  readonly unseen: readonly Browser.TabID[]
  /** The person's prompts that wait in the session's inbox, by inbox ID, with how each will be delivered. */
  readonly prompts: Readonly<Record<string, "steer" | "queue">>
  /**
   * The tab an agent's show request selected: in a closed pane, over another tab, or in a session nobody was looking
   * at. Its page stays hidden and its pane takes no input until the delay ends, which runs (`timing`) from the moment
   * the pane shows the tab to the person, so a press already on its way cannot land in it.
   */
  readonly reveal?: { readonly tabID: Browser.TabID; readonly token: number; readonly timing: boolean }
}

/** How long a kept show request may wait for the state it needs before it is dropped. */
export const HELD_REQUEST_TTL_MS = 5_000

/** A kept show request: the binding it came through, the tab, and what it asked. `token` names its expiry timer. */
export type Held = {
  readonly attempt: number
  readonly tabID: Browser.TabID
  readonly reveal: "none" | "tab"
  readonly token: number
}

/**
 * Every attachment of this window, which belongs to its shell session tab rather than the route. `issued` is the last
 * attempt or request id handed out. A Location whose browser RPC is not available blocks only its session.
 */
export type State =
  | {
      readonly status: "open"
      readonly ipc: Ipc
      readonly issued: number
      readonly sessions: Readonly<Record<string, Attachment | undefined>>
    }
  | { readonly status: "disposed" }

export type Event =
  /** The person's prompt entered the session's inbox. Steers, compactions and synthetic items are not reported. */
  | { readonly type: "prompt.enqueued"; readonly sessionKey: string; readonly id: string; readonly delivery: "steer" | "queue" }
  | { readonly type: "inbox.delivery.changed"; readonly sessionKey: string; readonly id: string; readonly delivery: "steer" | "queue" }
  | { readonly type: "inbox.delivered" | "inbox.cancelled"; readonly sessionKey: string; readonly id: string }
  | { readonly type: "pane.file"; readonly sessionKey: string; readonly attempt: number; readonly path: string; readonly enabled: boolean; readonly onScreen: boolean; readonly room: boolean; readonly opened: boolean }
  | { readonly type: "side.changed"; readonly sessionKey: string; readonly open: boolean; readonly running: boolean }
  | { readonly type: "execution.ended"; readonly sessionKey: string }
  | { readonly type: "activity.seen"; readonly sessionKey: string; readonly tabID: Browser.TabID }
  /** The pane now shows the revealed tab to the person: it is the tab on screen, in a window that is not hidden. */
  | { readonly type: "reveal.drawn"; readonly sessionKey: string; readonly token: number }
  | { readonly type: "reveal.elapsed"; readonly sessionKey: string; readonly token: number }
  /** A kept show request waited `HELD_REQUEST_TTL_MS`. */
  | { readonly type: "held.expired"; readonly sessionKey: string; readonly token: number }
  /** The person no longer sees the session: another one is routed, or the window is hidden or minimized. */
  | { readonly type: "screen.left"; readonly sessionKey: string }
  | {
      readonly type: "pane.activity"
      /**
       * `none`: the tab is only marked. `tab`: the tab is selected, in a closed pane or in an open one that shows
       * another tab (a preview, or a tab the agent opened or focused to show it).
       */
      readonly reveal: "none" | "tab"
      readonly room: boolean
      readonly sessionKey: string
      readonly attempt: number
      readonly tabID: Browser.TabID
      readonly enabled: boolean
      readonly onScreen: boolean
      readonly opened: boolean
      readonly visible: boolean
    }
  | { readonly type: "disposed" }
  | { readonly type: "ipc.changed"; readonly ipc: Ipc }
  | { readonly type: "session.capability.changed"; readonly sessionKey: string }
  | { readonly type: "session.presence"; readonly sessionKey: string; readonly listed: boolean }
  | { readonly type: "session.rebind"; readonly sessionKey: string }
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
  /** The person asks to open the browser again, from a pane that said it could not (`sessionUnavailable`). */
  | { readonly type: "session.retry"; readonly sessionKey: string }
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
      /** The command that failed, which a notice names and can offer again. */
      readonly action: Browser.Action
      readonly error: string
      /** The pane's Ipc could not answer. */
      readonly unavailable: boolean
    }
  /** The person closed the failure's notice, or its time ran out. */
  | { readonly type: "failure.dismissed"; readonly sessionKey: string; readonly id: number }
  | { readonly type: "address.focused"; readonly sessionKey: string; readonly tabID: Browser.TabID }
  /** The person closed or selected, in the strip, a tab the strip stored and no inventory has named yet. */
  | { readonly type: "strip.tab.closed" | "strip.tab.selected"; readonly sessionKey: string; readonly tabID: string }
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
  | { readonly type: "present-file"; readonly sessionKey: string; readonly path: string; readonly select: boolean }
  /** Starts the time after which `held.expired` drops the kept show request. */
  | { readonly type: "expire-held"; readonly sessionKey: string; readonly token: number; readonly delayMs: number }
  /**
   * The state a kept show request waited for is there: the driver sends it again as `pane.activity`, with what is true
   * now for the screen, the pane and the person's setting.
   */
  | {
      readonly type: "present-held"
      readonly sessionKey: string
      readonly attempt: number
      readonly tabID: Browser.TabID
      readonly reveal: "none" | "tab"
    }
  /** Starts the delay after which `reveal.elapsed` shows the revealed page. */
  | { readonly type: "expire-reveal"; readonly sessionKey: string; readonly token: number }
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
      readonly action: Browser.Action
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
  /** Records the session's loaded pages in the browser history, and its tabs for the strip of the next launch. */
  | { readonly type: "record-history"; readonly sessionKey: string }
  /** The session is no longer attached: drop its per-session resources. */
  | { readonly type: "detach"; readonly sessionKey: string }
  | { readonly type: "forget-tabs"; readonly sessionKey: string }

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
  { type: "disposed" | "ipc.changed" | "session.attached" | "session.removed" | "session.routed" }
>

// No attachment shares an object with another, not even an empty one: the model reconciles the state into its store,
// which writes into existing objects in place, so a shared object would carry one session's change into the others.
const noFocus = (): AddressFocus => ({ status: "none" })

const noStrip = (): Strip => ({
  located: false,
  mirrored: [],
  prune: false,
  focus: undefined,
  dismissed: [],
  selected: undefined,
})

export function createInitialState(ipc: Ipc): State {
  return { status: "open", ipc, issued: 0, sessions: {} }
}

export function transition(state: State, event: Event): Transition {
  if (state.status === "disposed") return { state, effects: [] }

  if (event.type === "disposed") return dispose(state)

  if (event.type === "ipc.changed") return ipcChanged(state, event.ipc)

  if (event.type === "session.attached") return attached(state, event)

  if (event.type === "session.removed") return removed(state, event.sessionKeys)

  if (event.type === "session.routed") return routed(state, event.sessionKey)
  const attachment = state.sessions[event.sessionKey]

  if (!attachment) return { state, effects: [] }

  return session(state, event.sessionKey, attachment, event)
}

export function sessionSupported(state: State, key: string) {
  const phase = attachmentOf(state, key)?.phase

  return state.status === "open" && !(phase?.status === "blocked" && phase.reason === "unsupported")
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
 * The desktop has not answered with its first inventory yet, and is on its way to: the routed session is about to
 * attach, it registered and waits, it waits for the pane's Ipc to start, or it registers again after no more than
 * `PENDING_RETRIES` failures in a row.
 */
export function sessionPending(state: State, target: Target) {
  if (state.status === "disposed") return false
  const attachment = state.sessions[target.key]

  if (!attachment) return target.server.compatible && !target.pending

  if (attachment.browser || attachment.failure) return false
  const phase = attachment.phase

  return (
    phase.status === "ready" ||
    ((phase.status === "registering" || phase.status === "backoff") && phase.attempts <= PENDING_RETRIES) ||
    (phase.status === "suspended" && phase.reason === "ipc" && state.ipc.status === "pending")
  )
}

/**
 * The session's browser could not open, and no inventory says what it had: its server has no browser, or registering
 * failed more than `PENDING_RETRIES` times in a row, while the retries go on. The pane says so in place of the page
 * and offers to try again (`session.retry`), never a loader with no end.
 */
export function sessionUnavailable(state: State, sessionKey: string) {
  const attachment = attachmentOf(state, sessionKey)

  if (!attachment || attachment.browser) return false
  const phase = attachment.phase

  return (
    (phase.status === "blocked" && phase.reason === "unsupported") ||
    ((phase.status === "registering" || phase.status === "backoff") && phase.attempts > PENDING_RETRIES)
  )
}

/**
 * Tab IDs to list in the side panel: the desktop's inventory, limited to tabs stored in the strip. Until the first
 * inventory arrives, the stored tabs, whatever the session's binding does meanwhile, so the strip keeps its tabs and
 * its selection; that inventory then prunes the ones it lacks. A session another window took, or one the server lacks,
 * lists none.
 */
export function sessionTabs(state: State, target: Target, open: readonly string[]) {
  if (state.status === "disposed") return []
  const attachment = state.sessions[target.key]

  // Not attached, as on a server whose version does not work with this app: only a session about to attach lists.
  if (!attachment) return sessionPending(state, target) ? open : []

  if (attachment.browser) return attachment.browser.tabs.flatMap((tab) => (open.includes(tab.id) ? [tab.id] : []))
  const phase = attachment.phase

  return phase.status === "blocked" && phase.reason !== "unsupported" ? [] : open
}

export function sessionBrowser(state: State, sessionKey: string) {
  return attachmentOf(state, sessionKey)?.browser ?? null
}

export function sessionTab(state: State, sessionKey: string, tabID: string) {
  return sessionBrowser(state, sessionKey)?.tabs.find((tab) => tab.id === tabID)
}

export function unseenActivity(state: State, sessionKey: string, tabID: string) {
  return attachmentOf(state, sessionKey)?.unseen.some(id => id === tabID) ?? false
}

export function revealGuard(state: State, sessionKey: string, tabID: string) {
  const reveal = attachmentOf(state, sessionKey)?.reveal

  return reveal?.tabID === tabID ? reveal.token : undefined
}

/**
 * Whether the session's attachment has its answer for now: the desktop took it, or it cannot attach until something
 * else happens (the pane does not run, another desktop owns the session, the server has no browser, a retry timer
 * runs). False while a registration, or the pane's Ipc that is still starting, can attach it without anyone acting.
 * A prompt waits on this, so its first step lists the browser tools.
 */
export function sessionSettled(state: State, sessionKey: string) {
  const phase = attachmentOf(state, sessionKey)?.phase

  if (!phase || state.status !== "open") return true

  if (phase.status === "idle" || phase.status === "registering") return false

  if (phase.status !== "suspended") return true

  return phase.reason === "unlisted" || (phase.reason === "ipc" && state.ipc.status !== "pending")
}

/**
 * Whether a prompt to the session waits for its attachment: only while one is in flight and can still succeed, on a
 * session whose server could answer it (`reachable`, see `attachable`). In every other state the prompt goes at once.
 */
export function sessionAttaching(state: State, sessionKey: string, reachable: boolean) {
  return reachable && !sessionSettled(state, sessionKey)
}

export function sessionSuspended(state: State, sessionKey: string) {
  return attachmentOf(state, sessionKey)?.phase.status === "suspended"
}

export function sessionError(state: State, sessionKey: string) {
  return attachmentOf(state, sessionKey)?.failure?.code
}

export function sessionFailure(state: State, sessionKey: string) {
  return attachmentOf(state, sessionKey)?.failure
}

export function sessionEmbed(state: State, sessionKey: string, tabID: string) {
  return attachmentOf(state, sessionKey)?.embeds[tabID]
}

/** The current binding's attempt; a new one, e.g. after a suspension, has no pages for restored tabs yet. */
export function sessionRegistration(state: State, sessionKey: string) {
  const phase = attachmentOf(state, sessionKey)?.phase

  // Registration effects install the IPC handle *after* publishing the registering state. Only acceptance
  // can wake the visible tab's loader: reading the Map while registering can consume the attempt too early.
  return phase?.status === "ready" ? phase.attempt : undefined
}

/** The blank tab the user just opened, whose pane focuses the address field once it shows it. */
export function addressFocusTab(state: State, sessionKey: string) {
  const focus = attachmentOf(state, sessionKey)?.addressFocus

  return focus?.status === "ready" ? focus.tabID : undefined
}

function dispose(state: Open): Transition {
  return {
    state: { status: "disposed" },
    effects: [
      ...listed(state.sessions).flatMap(([key, attachment]) => [...stop(key, attachment.phase), detach(key)]),
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
        { ...attachment, phase: { status: "registering", attempt, attempts: 0 }, embeds: {}, failure: undefined },
        [...result.effects, ...stop(key, phase), ...register(key, attempt, attachment.browser)],
        attempt,
      )
    },
    { state: { ...state, ipc }, effects: [] },
  )
}

function attached(state: Open, event: Extract<Event, { type: "session.attached" }>): Transition {
  if (state.sessions[event.sessionKey]) return { state, effects: [] }

  return put(state, event.sessionKey, {
    serverID: event.serverID,
    phase: { status: "idle" },
    browser: null,
    embeds: {},
    failure: undefined,
    strip: { ...noStrip(), located: event.located },
    addressFocus: noFocus(),
    side: "unobserved",
    shown: false,
    unseen: [],
    prompts: {},
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
    effects: gone.flatMap(([key, attachment]) => [...stop(key, attachment.phase), {type:"forget-tabs" as const,sessionKey:key}, detach(key)]),
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
        ...Object.fromEntries(reset.map(([key, attachment]) => [key, { ...attachment, addressFocus: noFocus() }])),
      },
    },
    effects: [],
  }
}

function session(state: Open, key: string, attachment: Attachment, event: SessionEvent): Transition {
  const phase = attachment.phase

  switch (event.type) {
    case "prompt.enqueued":
      return put(state, key, { ...attachment, prompts: { ...attachment.prompts, [event.id]: event.delivery } })
    case "inbox.delivery.changed": {
      if (!(event.id in attachment.prompts) || attachment.prompts[event.id] === event.delivery) return { state, effects: [] }

      return put(state, key, { ...attachment, prompts: { ...attachment.prompts, [event.id]: event.delivery } })
    }

    case "inbox.delivered":
    case "inbox.cancelled": {
      if (!(event.id in attachment.prompts)) return { state, effects: [] }
      // Only the person's next queued prompt starts over. A steer belongs to the run whose pane they closed.
      const next = event.type === "inbox.delivered" && attachment.prompts[event.id] === "queue" && attachment.side === "dismissed"

      return put(state, key, {
        ...attachment,
        side: next ? "closed" : attachment.side,
        // Their queued prompt is the next run, which has shown nothing yet.
        shown: event.type === "inbox.delivered" && attachment.prompts[event.id] === "queue" ? false : attachment.shown,
        prompts: Object.fromEntries(Object.entries(attachment.prompts).filter(([id]) => id !== event.id)),
      })
    }

    case "side.changed": {
      // Closing a pane that showed nothing of the agent's in this run, such as one the person opened to look at
      // something else, is not an answer to the agent: its next show request still opens the pane.
      const dismissed = event.running && (attachment.side === "dismissed" || (attachment.side === "open" && attachment.shown))
      const side = event.open ? "open" : dismissed ? "dismissed" : "closed"

      if (side === attachment.side) return { state, effects: [] }

      // The person closed the pane: a show request kept from before that does not open it again.
      const held = attachment.side === "open" && !event.open ? undefined : attachment.held

      return put(state, key, { ...attachment, side, held, reveal: event.open ? attachment.reveal : undefined })
    }

    case "execution.ended":
      // A show request kept from the run that ended, or was stopped, does not land after it.
      if (attachment.side !== "dismissed" && !attachment.shown) return unhold(state, key, attachment)

      return put(state, key, { ...attachment, held: undefined, side: attachment.side === "dismissed" ? "closed" : attachment.side, shown: false })
    case "held.expired":
      return attachment.held?.token === event.token ? unhold(state, key, attachment) : { state, effects: [] }
    case "screen.left":
      return unhold(state, key, attachment)
    case "reveal.drawn": {
      const reveal = attachment.reveal

      if (!reveal || reveal.token !== event.token || reveal.timing) return { state, effects: [] }

      return put(state, key, { ...attachment, reveal: { ...reveal, timing: true } }, [
        { type: "expire-reveal", sessionKey: key, token: reveal.token },
      ])
    }

    case "reveal.elapsed":
      return attachment.reveal?.token === event.token ? put(state, key, { ...attachment, reveal: undefined }) : { state, effects: [] }
    case "activity.seen":
      return attachment.unseen.includes(event.tabID)
        ? put(state, key, { ...attachment, unseen: attachment.unseen.filter(id => id !== event.tabID) })
        : { state, effects: [] }
    case "pane.file": {
      // Only the routed session has a file panel, which holds its own write until the session's location is known.
      if (!current(phase, event.attempt) || !event.onScreen) return { state, effects: [] }
      // A file preview is a show request: it takes the pane even when another tab is selected there.
      const select = event.room && event.enabled && attachment.side !== "dismissed"
      const effects: MachineEffect[] = [{ type: "present-file", sessionKey: key, path: event.path, select }]

      return select && !attachment.shown ? put(state, key, { ...attachment, shown: true }, effects) : { state, effects }
    }

    case "pane.activity":
      return current(phase, event.attempt) ? present(state, key, attachment, event) : { state, effects: [] }

    case "session.capability.changed":
      if (phase.status !== "blocked" || phase.reason !== "unsupported") return {state,effects:[]}

      return wake(state,key,suspend(attachment,"idle"),false)
    case "session.presence":
      if (event.listed) return phase.status === "suspended" && phase.reason === "unlisted" ? wake(state,key,suspend(attachment,"idle"),false) : {state,effects:[]}

      if (phase.status === "suspended" && phase.reason === "unlisted") return {state,effects:[]}

      return put(state,key,suspend(attachment,"unlisted"),stop(key,phase))
    case "session.rebind": {
      if (phase.status === "suspended" && phase.reason === "unlisted") return {state,effects:[]}
      const next = wake(state,key,suspend(attachment,"idle"),false)

      return {...next,effects:[...stop(key,phase),...next.effects]}
    }

    case "session.retry": {
      // A registration is already under way: it only counts the failures in a row from the start again.
      if (phase.status === "registering")
        return phase.attempts === 0 ? { state, effects: [] } : put(state, key, { ...attachment, phase: { ...phase, attempts: 0 } })

      if (phase.status !== "backoff" && !(phase.status === "blocked" && phase.reason === "unsupported"))
        return { state, effects: [] }
      // Registers now, in place of a retry timer.
      const next = wake(state, key, suspend(attachment, "idle"), false)

      return { ...next, effects: [...stop(key, phase), ...next.effects] }
    }

    case "session.located":
      return located(state, key, attachment, event.located)
    case "session.wake":
      return wake(state, key, attachment, false)
    case "session.created":
      return wake(state, key, attachment, true)
    case "session.command": {
      const reveal = attachment.reveal

      // Selecting the revealed tab in the strip answers with tabs.focus for it, which is the reveal itself, not the
      // person.
      if (reveal && event.action.type === "tabs.focus" && event.action.tabID === reveal.tabID)
        return command(state, key, attachment, event)

      // The person's own command ends the guard, so their navigation or tab switch is never held back, and a show
      // request kept from before it does not take the pane from what they just chose.
      if (!reveal && !attachment.held) return command(state, key, attachment, event)

      return command(state, key, { ...attachment, reveal: undefined, held: undefined }, event)
    }

    case "command.settled": {
      const focus = attachment.addressFocus

      if (focus.status !== "opening" || focus.request !== event.request) return { state, effects: [] }

      return put(state, key, { ...attachment, addressFocus: { ...focus, settled: true } })
    }

    case "command.failed":
      return commandFailed(state, key, attachment, event)
    case "failure.dismissed":
      return attachment.failure?.id === event.id ? put(state, key, { ...attachment, failure: undefined }) : { state, effects: [] }
    case "address.focused": {
      if (attachment.addressFocus.status !== "ready" || attachment.addressFocus.tabID !== event.tabID)
        return { state, effects: [] }

      return put(state, key, { ...attachment, addressFocus: noFocus() })
    }

    case "strip.tab.closed": {
      const strip = attachment.strip

      // With an inventory the tab is known, and its close is a command, or gone, and there is nothing to close.
      if (attachment.browser || strip.dismissed.includes(event.tabID)) return { state, effects: [] }

      return put(state, key, {
        ...attachment,
        strip: {
          ...strip,
          dismissed: [...strip.dismissed, event.tabID],
          selected: strip.selected === event.tabID ? undefined : strip.selected,
        },
      })
    }

    case "strip.tab.selected": {
      if (attachment.browser || attachment.strip.selected === event.tabID) return { state, effects: [] }

      return put(state, key, { ...attachment, strip: { ...attachment.strip, selected: event.tabID } })
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
          failure: undefined,
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

// The strip must be writable and the inventory must carry the tab before a show request can be decided.
function presentable(attachment: Attachment, tabID: Browser.TabID) {
  return attachment.strip.located && !!attachment.browser?.tabs.some((tab) => tab.id === tabID)
}

// Decides what an agent's activity does to the pane, from what the event says is true now. A request that arrives
// before the strip or its tab's inventory is kept as asked, with a bound, and nothing is dropped for arriving first.
function present(
  state: Open,
  key: string,
  attachment: Attachment,
  event: Extract<Event, { type: "pane.activity" }>,
): Transition {
  if (!presentable(attachment, event.tabID)) {
    const token = state.issued + 1
    const held = { attempt: event.attempt, tabID: event.tabID, reveal: event.reveal, token }

    return put(state, key, { ...attachment, held }, [{ type: "expire-held", sessionKey: key, token, delayMs: HELD_REQUEST_TTL_MS }], token)
  }

  // A newer request replaces a kept one.
  const settled = attachment.held ? { ...attachment, held: undefined } : attachment
  const unchanged = settled === attachment ? { state, effects: [] } : put(state, key, settled)

  // Off screen only a preview acts: its tab is selected in the session's strip, so it shows when the person returns.
  if (!event.onScreen && event.reveal !== "tab") return unchanged

  // The agent worked in the tab the person is looking at. The strip's selected tab is not on show while its pane is
  // closed.
  if (event.onScreen && event.opened && event.visible) return settled.shown ? unchanged : put(state, key, { ...settled, shown: true })
  const marked = settled.unseen.includes(event.tabID) ? settled.unseen : [...settled.unseen, event.tabID]

  const select =
    event.enabled &&
    settled.side !== "dismissed" &&
    (!event.onScreen || (event.room && event.reveal === "tab"))

  if (!select) return marked === settled.unseen ? unchanged : put(state, key, { ...settled, unseen: marked })
  const focus: MachineEffect = { type: "focus-strip-tab", sessionKey: key, tabID: event.tabID }
  const token = state.issued + 1
  const reveal = { token, tabID: event.tabID, timing: false }

  // Nobody is looking: the tab waits selected, with its mark. Its guard waits too, since the person may be back before
  // the selection lands. The delay starts only when the pane shows them the tab, so it costs nothing until then.
  if (!event.onScreen) return put(state, key, { ...settled, unseen: marked, reveal }, [focus], token)

  return put(state, key, { ...settled, shown: true, reveal }, [focus], token)
}

// Drops a kept show request without applying it.
function unhold(state: Open, key: string, attachment: Attachment): Transition {
  return attachment.held ? put(state, key, { ...attachment, held: undefined }) : { state, effects: [] }
}

// The state a kept request waited for may be there now. It is not decided here from what was true when it arrived:
// the driver sends it again with what is true now. One that came through a binding since superseded is dropped.
function settle(result: { readonly state: Open; readonly effects: readonly MachineEffect[] }, key: string): Transition {
  const attachment = result.state.sessions[key]
  const held = attachment?.held

  if (!attachment || !held) return result

  if (!current(attachment.phase, held.attempt)) {
    const dropped = unhold(result.state, key, attachment)

    return { state: dropped.state, effects: result.effects }
  }

  if (!presentable(attachment, held.tabID)) return result
  const landed = unhold(result.state, key, attachment)

  return {
    state: landed.state,
    effects: [
      ...result.effects,
      { type: "present-held", sessionKey: key, attempt: held.attempt, tabID: held.tabID, reveal: held.reveal },
    ],
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

  return settle(
    put(
      state,
      key,
      { ...attachment, strip: { ...strip, located: true, mirrored: ids ?? [], prune: false, focus: undefined } },
      [
        ...(ids ? sync(key, ids, strip.mirrored, strip.prune) : []),
        ...(focus && ids?.includes(focus) ? [{ type: "focus-strip-tab" as const, sessionKey: key, tabID: focus }] : []),
      ],
    ),
    key,
  )
}

// Passive edges wake an idle or suspended pane without bypassing transport backoff or duplicating a binding. Only the
// server creating the session lifts `missing`; nothing lifts `replaced` but the user's next session visit elsewhere.
function wake(state: Open, key: string, attachment: Attachment, created: boolean): Transition {
  const phase = attachment.phase

  if (phase.status === "suspended" && phase.reason === "unlisted") return {state,effects:[]}

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
    { ...attachment, phase: { status: "registering", attempt, attempts: 0 }, embeds: {}, failure: undefined },
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
    ? { status: "opening", request, known: attachment.browser?.tabs.map((tab) => tab.id) ?? [], settled: false }
    : attachment.addressFocus

  if (phase.status === "registering" || phase.status === "ready")
    return put(
      state,
      key,
      { ...attachment, failure: undefined, addressFocus: focus },
      [{ type: "send-command", sessionKey: key, attempt: phase.attempt, request, action: event.action }],
      request,
    )

  if (phase.status === "backoff" || phase.status === "blocked" || (phase.status === "suspended" && phase.reason === "unlisted")) {
    const error =
      phase.status === "blocked" && phase.reason === "replaced" ? "browser.pane.replaced" : "browser.pane.unavailable"

    return put(
      state,
      key,
      { ...attachment, failure: undefined, addressFocus: noFocus() },
      [{ type: "reject-command", sessionKey: key, request, action: event.action, error, unavailable: false }],
      request,
    )
  }

  // An unreachable pane is suspended, not a failed request.
  if (state.ipc.status !== "active")
    return put(
      state,
      key,
      { ...suspend(attachment, "ipc"), addressFocus: noFocus() },
      [{ type: "reject-command", sessionKey: key, request, action: event.action, error: "browser.pane.unavailable", unavailable: true }],
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
      failure: undefined,
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
      ? noFocus()
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
    failure: { id: event.request, code: replaced ? "browser.pane.replaced" : event.error, action: event.action },
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

  // RPC registration belongs to a Location. A cold project says nothing about the other projects on its server.
  if (event.error === "browser.pane.unsupported") {
    return put(state,key,{...attachment,phase:{status:"blocked",reason:"unsupported"},embeds:{}},stop(key,phase))
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
        failure: replaced ? { id: state.issued + 1, code: "browser.pane.replaced", action: undefined } : undefined,
        strip: { ...noStrip(), located: attachment.strip.located },
        addressFocus: noFocus(),
      },
      stop(key, phase),
      replaced ? state.issued + 1 : undefined,
    )
  }

  // Main closed the binding, or never took it. Keep the tabs and register again with backoff.
  if (event.error === "browser.pane.registration.closed")
    return backoff(state, key, event.state ? { ...attachment, browser: event.state } : attachment, phase)

  // Idle eviction has no retry timer: a user or Session execution wakes it on demand.
  if (event.error === "browser.pane.suspended") {
    const browser = event.state ?? attachment.browser
    const mirrored = event.state ? mirror(key, attachment.strip, browser, false) : undefined

    return put(state, key, { ...suspend(attachment, "idle", browser), strip: mirrored?.strip ?? attachment.strip }, [
      ...stop(key, phase),
      ...(mirrored?.effects ?? []),
    ])
  }

  // What the person did to saved tabs before this inventory named them reaches the desktop now, as their commands:
  // a tab they closed closes there and is not mirrored back, and the one they selected comes to the front.
  const strip = attachment.strip
  const dismissed = event.state?.tabs.flatMap((tab) => (strip.dismissed.includes(tab.id) ? [tab.id] : [])) ?? []
  const selected = event.state?.tabs.find((tab) => tab.id === strip.selected)?.id

  const early: Browser.Action[] = [
    ...dismissed.map((tabID) => ({ type: "tabs.close" as const, tabID })),
    ...(selected && selected !== event.state?.focusedTabID ? [{ type: "tabs.focus" as const, tabID: selected }] : []),
  ]

  const mirrored = mirror(
    key,
    { ...strip, mirrored: [...strip.mirrored, ...dismissed], dismissed: [], selected: undefined },
    event.state,
    true,
  )

  // An inventory that repeats the error it reported last is the same failure, not a new one to read again.
  const repeated = attachment.failure?.action === undefined && attachment.failure?.code === event.error

  const failure =
    event.error === undefined || repeated
      ? moved(attachment, event.state) ? undefined : attachment.failure
      : { id: state.issued + 1, code: event.error, action: undefined }

  // A tab the desktop had and has no more closed: a show request kept for it has nothing to show.
  const closed =
    !!attachment.held &&
    !!attachment.browser?.tabs.some((tab) => tab.id === attachment.held?.tabID) &&
    !event.state?.tabs.some((tab) => tab.id === attachment.held?.tabID)

  const issued = failure === attachment.failure ? state.issued : state.issued + 1

  // The strip gets the inventory's tabs first, so a kept request selects a tab the strip already has.
  return settle(
    put(
      state,
      key,
      {
        ...attachment,
        held: closed ? undefined : attachment.held,
        phase: { status: "ready", attempt: phase.attempt },
        browser: event.state,
        unseen: attachment.unseen.filter(id => event.state?.tabs.some(tab => tab.id === id)),
        failure,
        strip: mirrored.strip,
        addressFocus: follow(attachment.addressFocus, event.state),
      },
      [
        ...(phase.status === "registering" ? [{ type: "cancel-register-timeout" as const, sessionKey: key }] : []),
        // The saved tabs follow the inventory before the strip does, so a tab the strip drops for it is forgotten by
        // then, not offered as one the person closed.
        ...(event.state ? [{ type: "record-history" as const, sessionKey: key }] : []),
        ...mirrored.effects,
        ...early.map((action, index) => ({
          type: "send-command" as const,
          sessionKey: key,
          attempt: phase.attempt,
          request: issued + index + 1,
          action,
        })),
      ],
      issued + early.length,
    ),
    key,
  )
}

// A failed command names a tab's page. Once that tab shows another document, or is gone, the failure is about a page
// the person no longer sees.
function moved(attachment: Attachment, browser: Browser.State | null) {
  const action = attachment.failure?.action

  if (!action || !("tabID" in action)) return false
  const generation = (state: Browser.State | null) => state?.tabs.find((tab) => tab.id === action.tabID)?.generation

  return generation(attachment.browser) !== generation(browser)
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
      failure: undefined,
      addressFocus: noFocus(),
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
  if (!browser) return { strip: { ...noStrip(), located: strip.located }, effects: [] }
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

    return tab && blank(tab) ? focus : noFocus()
  }

  const added = tabs.filter((tab) => !focus.known.includes(tab.id))

  if (added.length === 0) return focus.settled ? noFocus() : focus
  const opened = added.find(blank)

  return opened ? { status: "ready", tabID: opened.id } : noFocus()
}

function blank(tab: Browser.Tab) {
  return !tab.url || tab.url === "about:blank"
}

function suspend(attachment: Attachment, reason: Extract<Phase,{status:"suspended"}>["reason"], browser = attachment.browser): Attachment {
  return {
    ...attachment,
    phase: { status: "suspended", reason },
    browser,
    embeds: {},
    failure: undefined,
    addressFocus: noFocus(),
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
