import type { PersistentPtyInfo } from "@opencode/client"

/**
 * How long one terminal request may take before it fails: the support check, a list, a create (including the wait
 * for a session the server is still creating), a close or a rename. A server can accept a request and never answer.
 */
export const TERMINAL_REQUEST_TIMEOUT_MS = 15_000

/**
 * A session's terminal list once the server offers terminals. `connection` is the server connection whose answer the
 * known list is: a refresh keeps the previous one until it answers. `items` holds only what the server confirmed.
 */
export type List =
  | { readonly status: "loading"; readonly attempt: number }
  | { readonly status: "ready"; readonly connection: number; readonly items: readonly PersistentPtyInfo[] }
  | {
      readonly status: "refreshing"
      readonly connection: number
      readonly items: readonly PersistentPtyInfo[]
      readonly attempt: number
    }
  | { readonly status: "failed"; readonly error: string }

/** A session's terminal list while the server's support is checked again: a known list stays shown. */
export type Held =
  | { readonly status: "waiting" }
  | { readonly status: "ready"; readonly connection: number; readonly items: readonly PersistentPtyInfo[] }

/**
 * This client's terminal changes in flight for one session, each with its request's attempt. Every new-terminal
 * request joins the one `creating` create. A terminal has at most one `closing` request and one rename; a pending
 * rename's title shows over the confirmed list until the server answers.
 */
export type Mutations = {
  readonly creating?: number
  readonly closing: Readonly<Record<string, number>>
  readonly renames: Readonly<Record<string, { readonly attempt: number; readonly title: string | null }>>
}

/**
 * One server's terminal support and the terminal lists of its loaded sessions. Each request takes the server's next
 * attempt number, so an answer whose attempt the state no longer holds is stale. `issued` is the last one handed out.
 * `connections` counts the server's connections: each reconnect, such as after a restart, starts the next one.
 */
export type State =
  | { readonly status: "unknown" }
  | {
      readonly status: "checking"
      readonly connections: number
      readonly attempt: number
      readonly issued: number
      readonly sessions: Readonly<Record<string, Held>>
      readonly mutations: Readonly<Record<string, Mutations>>
    }
  | {
      readonly status: "unsupported"
      readonly connections: number
      readonly issued: number
      readonly sessions: readonly string[]
    }
  | {
      readonly status: "failed"
      readonly connections: number
      readonly issued: number
      readonly sessions: readonly string[]
      readonly error: string
    }
  | {
      readonly status: "supported"
      readonly connections: number
      readonly issued: number
      readonly sessions: Readonly<Record<string, List>>
      readonly mutations: Readonly<Record<string, Mutations>>
    }

/** Why a create ended without a terminal: an outdated server, a failed or timed-out request, or a cancel. */
export type CreateFailure = "unsupported" | "failed" | "cancelled"

export type Event =
  /** The model started following the server, its event stream connected again, or a restarted server replaced it. */
  | { readonly type: "server.connected" }
  | { readonly type: "capability.checked"; readonly attempt: number; readonly supported: boolean }
  /** The support check failed or timed out. */
  | { readonly type: "capability.failed"; readonly attempt: number; readonly error: string }
  | { readonly type: "session.loaded"; readonly sessionID: string }
  /** The server reported a terminal change, or this client changed the session's terminals. */
  | { readonly type: "session.refresh"; readonly sessionID: string }
  /** The user asks to load the session's terminals again after a failure. */
  | { readonly type: "session.retry"; readonly sessionID: string }
  | {
      readonly type: "list.loaded"
      readonly sessionID: string
      readonly attempt: number
      readonly items: readonly PersistentPtyInfo[]
    }
  /** The list answered 503: the server's terminal daemon can't run. */
  | { readonly type: "list.unavailable"; readonly sessionID: string; readonly attempt: number }
  /** The list failed or timed out. */
  | { readonly type: "list.failed"; readonly sessionID: string; readonly attempt: number; readonly error: string }
  /** The server sent a terminal's new info. */
  | { readonly type: "terminal.updated"; readonly sessionID: string; readonly terminal: PersistentPtyInfo }
  /** The user asks for a new terminal. A request while one is being created joins it. */
  | { readonly type: "create.requested"; readonly sessionID: string }
  | {
      readonly type: "create.succeeded"
      readonly sessionID: string
      readonly attempt: number
      readonly terminal: PersistentPtyInfo
    }
  /** The create failed or timed out. */
  | {
      readonly type: "create.failed"
      readonly sessionID: string
      readonly attempt: number
      readonly kind: "unsupported" | "failed"
      readonly error: string
    }
  /** The user closes a terminal. A request while it is closing joins it. */
  | { readonly type: "close.requested"; readonly sessionID: string; readonly ptyID: string }
  /** The server removed the terminal, or it was already gone. */
  | { readonly type: "close.succeeded"; readonly sessionID: string; readonly ptyID: string; readonly attempt: number }
  /** The close failed or timed out. */
  | {
      readonly type: "close.failed"
      readonly sessionID: string
      readonly ptyID: string
      readonly attempt: number
      readonly error: string
    }
  /** The user sets a terminal's title; `null` clears it. */
  | {
      readonly type: "rename.requested"
      readonly sessionID: string
      readonly ptyID: string
      readonly title: string | null
    }
  | {
      readonly type: "rename.succeeded"
      readonly sessionID: string
      readonly ptyID: string
      readonly attempt: number
      readonly terminal: PersistentPtyInfo
    }
  /** The rename failed or timed out. */
  | {
      readonly type: "rename.failed"
      readonly sessionID: string
      readonly ptyID: string
      readonly attempt: number
      readonly kind: "unsupported" | "failed"
      readonly error: string
    }
  | { readonly type: "sessions.removed"; readonly sessionIDs: readonly string[] }
  /**
   * The model goes away, as on a plugin reload. Changes in flight end; the confirmed lists stay for the next instance,
   * which checks the server again.
   */
  | { readonly type: "instance.stopped" }

export type Command =
  | { readonly type: "check-capability"; readonly attempt: number }
  | { readonly type: "load-list"; readonly sessionID: string; readonly attempt: number }
  /** Waits for a session the server is still creating, lists it when `known` is undefined, and creates a terminal. */
  | {
      readonly type: "create-terminal"
      readonly sessionID: string
      readonly attempt: number
      readonly known: readonly PersistentPtyInfo[] | undefined
    }
  | { readonly type: "close-terminal"; readonly sessionID: string; readonly ptyID: string; readonly attempt: number }
  | {
      readonly type: "rename-terminal"
      readonly sessionID: string
      readonly ptyID: string
      readonly title: string | null
      readonly attempt: number
    }
  /** Cancels requests whose answers the state no longer waits for. */
  | { readonly type: "abort"; readonly attempts: readonly number[] }
  /** Adds the listed terminals the strip doesn't store yet, such as ones another client created. */
  | { readonly type: "sync-tabs"; readonly sessionID: string; readonly items: readonly PersistentPtyInfo[] }
  /** Answers every new-terminal request the create joined: selects the terminal, or tells the user why not. */
  | {
      readonly type: "settle-create"
      readonly sessionID: string
      readonly outcome:
        | { readonly ok: true; readonly terminal: PersistentPtyInfo }
        | { readonly ok: false; readonly kind: CreateFailure; readonly error?: string }
    }
  | { readonly type: "toast-close-failed"; readonly error: string }
  | { readonly type: "toast-rename-failed"; readonly kind: "unsupported" | "failed"; readonly error: string }

export type Transition = { readonly state: State; readonly commands: readonly Command[] }

/** What a session's terminal panel shows. */
export type View =
  | { readonly type: "loading" }
  | { readonly type: "unsupported" }
  | { readonly type: "failed"; readonly error: string }
  | { readonly type: "ready"; readonly items: readonly PersistentPtyInfo[] }

type Supported = Extract<State, { status: "supported" }>

type Active = Extract<State, { status: "checking" | "supported" }>

export const initialState: State = { status: "unknown" }

const LOADING: View = { type: "loading" }

const UNSUPPORTED: View = { type: "unsupported" }

const NONE: readonly PersistentPtyInfo[] = []

export function transition(state: State, event: Event): Transition {
  if (state.status === "unknown") return unknown(state, event)

  if (state.status === "checking" || state.status === "supported") {
    if (event.type === "instance.stopped") return stopped(state)

    if (event.type === "sessions.removed") return removed(state, event.sessionIDs)

    const mutated = mutate(state, event)

    if (mutated) return mutated

    return state.status === "checking" ? checking(state, event) : supported(state, event)
  }

  return resting(state, event)
}

/** Servers that predate the capability report nothing and still offer terminals, until a check says otherwise. */
export function serverAvailable(state: State) {
  return state.status !== "unsupported" && state.status !== "failed"
}

export function sessionView(state: State, sessionID: string): View {
  if (state.status === "unknown") return LOADING

  if (state.status === "unsupported") return UNSUPPORTED

  if (state.status === "failed") return { type: "failed", error: state.error }

  const session = state.sessions[sessionID]

  if (!session || session.status === "waiting" || session.status === "loading") return LOADING

  if (session.status === "failed") return { type: "failed", error: session.error }

  return { type: "ready", items: renamed(session.items, state.mutations[sessionID]) }
}

/** A new terminal is being created for the session; another request joins it. */
export function sessionCreating(state: State, sessionID: string) {
  return (
    (state.status === "checking" || state.status === "supported") && active(state, sessionID).creating !== undefined
  )
}

/**
 * The server connection whose answer the session's known list is, or 0 before one. It moves to a reconnect only once
 * that connection lists the session again, so a terminal the restarted server still runs can attach by then.
 */
export function sessionConnection(state: State, sessionID: string) {
  if (state.status !== "checking" && state.status !== "supported") return 0
  const session = state.sessions[sessionID]

  return session?.status === "ready" || session?.status === "refreshing" ? session.connection : 0
}

/** The listed terminals, in the server's order; none until the list is known. */
export function viewItems(current: View) {
  return current.type === "ready" ? current.items : NONE
}

/**
 * The strip's terminal tabs. Until the server lists the session's terminals the stored tabs stay, so restore keeps
 * them; then the ones it no longer lists leave and the ones the strip doesn't store yet join at the end.
 */
export function viewTabs(current: View, open: readonly string[]) {
  if (current.type !== "ready") return [...new Set(open)]
  const live = new Set(current.items.map((info) => info.id))

  return [...new Set([...open.filter((id) => live.has(id)), ...live])]
}

/** Stored tabs stay hidden while the panel has nothing to show for them. */
export function tabHidden(current: View) {
  return current.type === "loading" || current.type === "unsupported"
}

/** A tab can be selected and focused unless the server's list leaves its terminal out. */
export function tabTargetable(current: View, id: string) {
  return current.type !== "ready" || current.items.some((info) => info.id === id)
}

function unknown(state: State, event: Event): Transition {
  if (event.type === "server.connected") return check(1, {}, 1, {})

  if (event.type === "session.loaded") return check(1, { [event.sessionID]: { status: "waiting" } }, 1, {})

  if (event.type === "create.requested")
    return unchanged(state, [
      { type: "settle-create", sessionID: event.sessionID, outcome: { ok: false, kind: "cancelled" } },
    ])

  return unchanged(state)
}

function checking(state: Extract<State, { status: "checking" }>, event: Event): Transition {
  if (event.type === "server.connected")
    return check(state.issued + 1, state.sessions, state.connections + 1, state.mutations, [
      { type: "abort", attempts: [state.attempt] },
    ])

  if (event.type === "capability.checked" && event.attempt === state.attempt) {
    if (!event.supported) return lost(state, { status: "unsupported" })

    // Every session lists again; a list it already had stays shown meanwhile.
    const ids = Object.keys(state.sessions)

    const sessions = Object.fromEntries(
      ids.map((id, index): [string, List] => {
        const held = state.sessions[id]
        const attempt = state.issued + 1 + index

        if (held?.status === "ready")
          return [id, { status: "refreshing", connection: held.connection, items: held.items, attempt }]

        return [id, { status: "loading", attempt }]
      }),
    )

    return changed(
      {
        status: "supported",
        connections: state.connections,
        issued: state.issued + ids.length,
        sessions,
        mutations: state.mutations,
      },
      ids.map((sessionID, index): Command => ({ type: "load-list", sessionID, attempt: state.issued + 1 + index })),
    )
  }

  if (event.type === "capability.failed" && event.attempt === state.attempt)
    return lost(state, { status: "failed", error: event.error })

  if (event.type === "session.loaded" && !state.sessions[event.sessionID])
    return changed({ ...state, sessions: { ...state.sessions, [event.sessionID]: { status: "waiting" } } })

  if (event.type === "terminal.updated")
    return changed(withItems(state, event.sessionID, (items) => replace(items, event.terminal)))

  return unchanged(state)
}

function resting(state: Extract<State, { status: "unsupported" | "failed" }>, event: Event): Transition {
  if (event.type === "server.connected" || (event.type === "session.retry" && state.status === "failed"))
    return check(
      state.issued + 1,
      Object.fromEntries(state.sessions.map((id): [string, Held] => [id, { status: "waiting" }])),
      event.type === "server.connected" ? state.connections + 1 : state.connections,
      {},
    )

  if (event.type === "session.loaded" && !state.sessions.includes(event.sessionID))
    return changed({ ...state, sessions: [...state.sessions, event.sessionID] })

  if (event.type === "sessions.removed" && state.sessions.some((id) => event.sessionIDs.includes(id)))
    return changed({ ...state, sessions: state.sessions.filter((id) => !event.sessionIDs.includes(id)) })

  // A server without terminals answers a new-terminal request at once.
  if (event.type === "create.requested")
    return unchanged(state, [
      {
        type: "settle-create",
        sessionID: event.sessionID,
        outcome:
          state.status === "unsupported"
            ? { ok: false, kind: "unsupported" }
            : { ok: false, kind: "failed", error: state.error },
      },
    ])

  return unchanged(state)
}

function supported(state: Supported, event: Event): Transition {
  if (event.type === "server.connected")
    return check(
      state.issued + 1,
      Object.fromEntries(
        Object.entries(state.sessions).map(([id, list]): [string, Held] => {
          if (list.status === "ready" || list.status === "refreshing")
            return [id, { status: "ready", connection: list.connection, items: list.items }]

          return [id, { status: "waiting" }]
        }),
      ),
      state.connections + 1,
      state.mutations,
      abort(Object.values(state.sessions).flatMap(listAttempt)),
    )

  const list = "sessionID" in event ? state.sessions[event.sessionID] : undefined

  if (event.type === "session.loaded") return list ? unchanged(state) : load(state, event.sessionID)

  if (event.type === "session.refresh") return list ? load(state, event.sessionID) : unchanged(state)

  // Retrying a list that isn't failed would only repeat a request.
  if (event.type === "session.retry") return list?.status === "failed" ? load(state, event.sessionID) : unchanged(state)

  if (event.type === "list.loaded" || event.type === "list.unavailable" || event.type === "list.failed") {
    // Only the latest request for a session still loaded may settle it.
    if (!list || (list.status !== "loading" && list.status !== "refreshing") || list.attempt !== event.attempt)
      return unchanged(state)

    if (event.type === "list.loaded")
      return changed(
        put(state, event.sessionID, { status: "ready", connection: state.connections, items: event.items }),
        [{ type: "sync-tabs", sessionID: event.sessionID, items: event.items }],
      )

    // A server whose terminal daemon can't run offers no terminals until the next connection checks again.
    if (event.type === "list.unavailable") return lost(state, { status: "unsupported" })

    // A failed refresh keeps the terminals already shown.
    if (list.status === "refreshing")
      return changed(put(state, event.sessionID, { status: "ready", connection: list.connection, items: list.items }))

    return changed(put(state, event.sessionID, { status: "failed", error: event.error }))
  }

  if (event.type === "terminal.updated") {
    if (!list) return unchanged(state)

    if ((list.status === "ready" || list.status === "refreshing") && listed(list.items, event.terminal.id))
      return changed(put(state, event.sessionID, { ...list, items: replace(list.items, event.terminal) }))

    // A terminal the list doesn't have yet arrives with the next list.
    return load(state, event.sessionID)
  }

  return unchanged(state)
}

/** This client's creates, closes and renames, the same while support is checked again and once it is known. */
function mutate(state: Active, event: Event): Transition | undefined {
  if (!("sessionID" in event)) return
  const sessionID = event.sessionID
  const current = active(state, sessionID)

  if (event.type === "create.requested") {
    if (current.creating !== undefined) return unchanged(state)
    const attempt = state.issued + 1

    return changed(withMutations({ ...state, issued: attempt }, sessionID, { ...current, creating: attempt }), [
      { type: "create-terminal", sessionID, attempt, known: known(state, sessionID) },
    ])
  }

  if (event.type === "create.succeeded") {
    // A create that the state stopped waiting for still made a terminal; the list shows it once it refreshes.
    if (current.creating !== event.attempt) return refresh(state, sessionID)

    const next = withItems(
      withMutations(state, sessionID, { closing: current.closing, renames: current.renames }),
      sessionID,
      (items) => (listed(items, event.terminal.id) ? items : [...items, event.terminal]),
    )

    const settle: Command = { type: "settle-create", sessionID, outcome: { ok: true, terminal: event.terminal } }
    const refreshed = refresh(next, sessionID)

    return changed(refreshed.state, [settle, ...refreshed.commands])
  }

  if (event.type === "create.failed") {
    if (current.creating !== event.attempt) return unchanged(state)

    return changed(withMutations(state, sessionID, { closing: current.closing, renames: current.renames }), [
      { type: "settle-create", sessionID, outcome: { ok: false, kind: event.kind, error: event.error } },
    ])
  }

  if (event.type === "close.requested") {
    if (current.closing[event.ptyID] !== undefined) return unchanged(state)
    const attempt = state.issued + 1
    // Closing a terminal ends its rename.
    const rename = current.renames[event.ptyID]

    return changed(
      withMutations({ ...state, issued: attempt }, sessionID, {
        ...current,
        closing: { ...current.closing, [event.ptyID]: attempt },
        renames: without(current.renames, event.ptyID),
      }),
      [...abort(rename ? [rename.attempt] : []), { type: "close-terminal", sessionID, ptyID: event.ptyID, attempt }],
    )
  }

  if (event.type === "close.succeeded") {
    if (current.closing[event.ptyID] !== event.attempt) return unchanged(state)

    return refresh(
      withItems(
        withMutations(state, sessionID, { ...current, closing: without(current.closing, event.ptyID) }),
        sessionID,
        (items) => items.filter((info) => info.id !== event.ptyID),
      ),
      sessionID,
    )
  }

  if (event.type === "close.failed") {
    if (current.closing[event.ptyID] !== event.attempt) return unchanged(state)
    const items = known(state, sessionID)

    // The terminal still runs, so its tab, which the strip already let go of, comes back.
    return changed(withMutations(state, sessionID, { ...current, closing: without(current.closing, event.ptyID) }), [
      ...(items ? [{ type: "sync-tabs", sessionID, items } satisfies Command] : []),
      { type: "toast-close-failed", error: event.error },
    ])
  }

  if (event.type === "rename.requested") {
    const item = known(state, sessionID)?.find((info) => info.id === event.ptyID)
    const pending = current.renames[event.ptyID]

    if (!item || current.closing[event.ptyID] !== undefined) return unchanged(state)

    // The title already shown, or clearing a terminal never renamed, sends nothing.
    if (
      pending
        ? pending.title === event.title
        : event.title === item.title || (event.title === null && item.userTitle === null)
    )
      return unchanged(state)
    const attempt = state.issued + 1

    return changed(
      withMutations({ ...state, issued: attempt }, sessionID, {
        ...current,
        renames: { ...current.renames, [event.ptyID]: { attempt, title: event.title } },
      }),
      [
        ...abort(pending ? [pending.attempt] : []),
        { type: "rename-terminal", sessionID, ptyID: event.ptyID, title: event.title, attempt },
      ],
    )
  }

  if (event.type === "rename.succeeded" || event.type === "rename.failed") {
    // An older rename's answer is stale: the newer one decides, and the server's update event reports the result.
    if (current.renames[event.ptyID]?.attempt !== event.attempt) return unchanged(state)
    const next = withMutations(state, sessionID, { ...current, renames: without(current.renames, event.ptyID) })

    if (event.type === "rename.failed")
      return changed(next, [{ type: "toast-rename-failed", kind: event.kind, error: event.error }])

    return changed(withItems(next, sessionID, (items) => replace(items, event.terminal)))
  }

  return
}

/** Support went away: every change in flight ends, and new-terminal requests learn why. */
function lost(
  state: Active,
  next: { readonly status: "unsupported" } | { readonly status: "failed"; readonly error: string },
): Transition {
  const base = { connections: state.connections, issued: state.issued, sessions: Object.keys(state.sessions) }

  const outcome =
    next.status === "unsupported"
      ? ({ ok: false, kind: "unsupported" } as const)
      : ({ ok: false, kind: "failed", error: next.error } as const)

  return changed(
    next.status === "unsupported"
      ? { status: "unsupported", ...base }
      : { status: "failed", ...base, error: next.error },
    [
      ...abort(attempts(state, [...new Set([...Object.keys(state.sessions), ...Object.keys(state.mutations)])])),
      ...settleCreates(state, Object.keys(state.mutations), outcome),
    ],
  )
}

function removed(state: Active, ids: readonly string[]): Transition {
  if (!ids.some((id) => id in state.sessions || id in state.mutations)) return unchanged(state)
  const mutations = omit(state.mutations, ids)

  const commands = [
    ...abort(attempts(state, ids)),
    ...settleCreates(state, ids, { ok: false, kind: "cancelled" } as const),
  ]

  if (state.status === "checking")
    return changed({ ...state, sessions: omit(state.sessions, ids), mutations }, commands)

  return changed({ ...state, sessions: omit(state.sessions, ids), mutations }, commands)
}

/** The confirmed lists stay for the next instance; the changes in flight end with this one. */
function stopped(state: Active): Transition {
  if (Object.keys(state.mutations).length === 0) return unchanged(state)

  return changed(
    { ...state, mutations: {} },
    settleCreates(state, Object.keys(state.mutations), { ok: false, kind: "cancelled" } as const),
  )
}

function settleCreates(
  state: Active,
  ids: readonly string[],
  outcome: { readonly ok: false; readonly kind: CreateFailure; readonly error?: string },
): Command[] {
  return ids.flatMap((sessionID): Command[] =>
    state.mutations[sessionID]?.creating === undefined ? [] : [{ type: "settle-create", sessionID, outcome }],
  )
}

/** Every request in flight for the sessions: their lists and this client's changes. */
function attempts(state: Active, ids: readonly string[]) {
  return ids.flatMap((id) => {
    const entry = state.sessions[id]
    const mutations = state.mutations[id]
    const list = entry && entry.status !== "waiting" ? listAttempt(entry) : []

    if (!mutations) return list

    return [
      ...list,
      ...(mutations.creating === undefined ? [] : [mutations.creating]),
      ...Object.values(mutations.closing),
      ...Object.values(mutations.renames).map((rename) => rename.attempt),
    ]
  })
}

function listAttempt(list: List) {
  return list.status === "loading" || list.status === "refreshing" ? [list.attempt] : []
}

/** Lists the session again once support is known; while it is checked, the check's lists will. */
function refresh(state: Active, sessionID: string): Transition {
  if (state.status === "supported" && state.sessions[sessionID]) return load(state, sessionID)

  return unchanged(state)
}

function load(state: Supported, sessionID: string): Transition {
  const attempt = state.issued + 1
  const list = state.sessions[sessionID]

  const next =
    list?.status === "ready" || list?.status === "refreshing"
      ? ({ status: "refreshing", connection: list.connection, items: list.items, attempt } satisfies List)
      : ({ status: "loading", attempt } satisfies List)

  // Only the newest list may answer, so the one it replaces stops.
  return changed({ ...put(state, sessionID, next), issued: attempt }, [
    ...abort(list ? listAttempt(list) : []),
    { type: "load-list", sessionID, attempt },
  ])
}

function check(
  attempt: number,
  sessions: Readonly<Record<string, Held>>,
  connections: number,
  mutations: Readonly<Record<string, Mutations>>,
  commands: readonly Command[] = [],
): Transition {
  return changed({ status: "checking", connections, attempt, issued: attempt, sessions, mutations }, [
    ...commands,
    { type: "check-capability", attempt },
  ])
}

function abort(attempts: readonly number[]): Command[] {
  return attempts.length > 0 ? [{ type: "abort", attempts }] : []
}

/** The session's changes in flight; a fresh object each time, as the state lives in a store. */
function active(state: Active, sessionID: string): Mutations {
  return state.mutations[sessionID] ?? { closing: {}, renames: {} }
}

function known(state: Active, sessionID: string) {
  const entry = state.sessions[sessionID]

  return entry?.status === "ready" || entry?.status === "refreshing" ? entry.items : undefined
}

function withMutations<T extends Active>(state: T, sessionID: string, next: Mutations): T {
  const idle =
    next.creating === undefined && Object.keys(next.closing).length === 0 && Object.keys(next.renames).length === 0

  return { ...state, mutations: idle ? omit(state.mutations, [sessionID]) : { ...state.mutations, [sessionID]: next } }
}

/** Changes a known list's confirmed terminals; a list not known yet stays as it is. */
function withItems<T extends Active>(
  state: T,
  sessionID: string,
  change: (items: readonly PersistentPtyInfo[]) => readonly PersistentPtyInfo[],
): T {
  if (state.status === "checking") {
    const held = state.sessions[sessionID]

    if (held?.status !== "ready") return state
    const items = change(held.items)

    return items === held.items ? state : { ...state, sessions: { ...state.sessions, [sessionID]: { ...held, items } } }
  }

  const list = state.sessions[sessionID]

  if (list?.status !== "ready" && list?.status !== "refreshing") return state
  const items = change(list.items)

  return items === list.items ? state : { ...state, sessions: { ...state.sessions, [sessionID]: { ...list, items } } }
}

/** Shows each pending rename's new title over the confirmed list; a cleared title shows what the server falls back to. */
function renamed(items: readonly PersistentPtyInfo[], mutations: Mutations | undefined) {
  if (!mutations || !Object.values(mutations.renames).some((rename) => rename.title !== null)) return items

  return items.map((info) => {
    const title = mutations.renames[info.id]?.title

    return title === undefined || title === null ? info : { ...info, title, userTitle: title }
  })
}

function put(state: Supported, sessionID: string, list: List): Supported {
  return { ...state, sessions: { ...state.sessions, [sessionID]: list } }
}

function omit<T>(record: Readonly<Record<string, T>>, ids: readonly string[]) {
  return Object.fromEntries(Object.entries(record).filter(([id]) => !ids.includes(id)))
}

function without<T>(record: Readonly<Record<string, T>>, id: string) {
  return omit(record, [id])
}

function listed(list: readonly PersistentPtyInfo[], id: string) {
  return list.some((info) => info.id === id)
}

function replace(list: readonly PersistentPtyInfo[], terminal: PersistentPtyInfo) {
  return listed(list, terminal.id) ? list.map((info) => (info.id === terminal.id ? terminal : info)) : list
}

function changed(state: State, commands: readonly Command[] = []): Transition {
  return { state, commands }
}

function unchanged(state: State, commands: readonly Command[] = []): Transition {
  return { state, commands }
}
