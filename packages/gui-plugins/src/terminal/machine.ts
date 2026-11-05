import type { PersistentPtyInfo } from "@opencode/client"

/**
 * A session's terminal list once the server offers terminals. `connection` is the server connection whose answer the
 * known list is: a refresh keeps the previous one until it answers.
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
      readonly sessions: Readonly<Record<string, Held>>
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
    }

export type Event =
  /** The model started following the server, its event stream connected again, or a restarted server replaced it. */
  | { readonly type: "server.connected" }
  | { readonly type: "capability.checked"; readonly attempt: number; readonly supported: boolean }
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
  | { readonly type: "list.failed"; readonly sessionID: string; readonly attempt: number; readonly error: string }
  /** The server sent a terminal's new info. */
  | { readonly type: "terminal.updated"; readonly sessionID: string; readonly terminal: PersistentPtyInfo }
  /** This client changed a listed terminal's info. */
  | { readonly type: "terminal.replaced"; readonly sessionID: string; readonly terminal: PersistentPtyInfo }
  /**
   * This client created a terminal. It joins a known list at once: the refresh that follows can lose to a newer one
   * the server's `persistent-pty.added` started, and the tab must be listed when it is selected.
   */
  | { readonly type: "terminal.created"; readonly sessionID: string; readonly terminal: PersistentPtyInfo }
  | { readonly type: "sessions.removed"; readonly sessionIDs: readonly string[] }

export type Command =
  | { readonly type: "check-capability"; readonly attempt: number }
  | { readonly type: "load-list"; readonly sessionID: string; readonly attempt: number }
  /** Adds the listed terminals the strip doesn't store yet, such as ones another client created. */
  | { readonly type: "sync-tabs"; readonly sessionID: string; readonly items: readonly PersistentPtyInfo[] }

export type Transition = { readonly state: State; readonly commands: readonly Command[] }

/** What a session's terminal panel shows. */
export type View =
  | { readonly type: "loading" }
  | { readonly type: "unsupported" }
  | { readonly type: "failed"; readonly error: string }
  | { readonly type: "ready"; readonly items: readonly PersistentPtyInfo[] }

type Supported = Extract<State, { status: "supported" }>

export const initialState: State = { status: "unknown" }

const LOADING: View = { type: "loading" }

const UNSUPPORTED: View = { type: "unsupported" }

const NONE: readonly PersistentPtyInfo[] = []

export function transition(state: State, event: Event): Transition {
  if (state.status === "unknown") return unknown(state, event)

  if (state.status === "checking") return checking(state, event)

  if (state.status === "supported") return supported(state, event)

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

  return { type: "ready", items: session.items }
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
  if (event.type === "server.connected") return check(1, {}, 1)

  if (event.type === "session.loaded") return check(1, { [event.sessionID]: { status: "waiting" } }, 1)

  return unchanged(state)
}

function checking(state: Extract<State, { status: "checking" }>, event: Event): Transition {
  if (event.type === "server.connected") return check(state.attempt + 1, state.sessions, state.connections + 1)

  if (event.type === "capability.checked" && event.attempt === state.attempt) {
    if (!event.supported)
      return changed({
        status: "unsupported",
        connections: state.connections,
        issued: state.attempt,
        sessions: Object.keys(state.sessions),
      })

    // Every session lists again; a list it already had stays shown meanwhile.
    const ids = Object.keys(state.sessions)

    const sessions = Object.fromEntries(
      ids.map((id, index): [string, List] => {
        const held = state.sessions[id]
        const attempt = state.attempt + 1 + index

        if (held?.status === "ready")
          return [id, { status: "refreshing", connection: held.connection, items: held.items, attempt }]

        return [id, { status: "loading", attempt }]
      }),
    )

    return changed(
      { status: "supported", connections: state.connections, issued: state.attempt + ids.length, sessions },
      ids.map((sessionID, index): Command => ({ type: "load-list", sessionID, attempt: state.attempt + 1 + index })),
    )
  }

  if (event.type === "capability.failed" && event.attempt === state.attempt)
    return changed({
      status: "failed",
      connections: state.connections,
      issued: state.attempt,
      sessions: Object.keys(state.sessions),
      error: event.error,
    })

  if (event.type === "session.loaded" && !state.sessions[event.sessionID])
    return changed({ ...state, sessions: { ...state.sessions, [event.sessionID]: { status: "waiting" } } })

  if (event.type === "terminal.updated" || event.type === "terminal.replaced") {
    const held = state.sessions[event.sessionID]

    if (held?.status !== "ready" || !listed(held.items, event.terminal.id)) return unchanged(state)

    return changed({
      ...state,
      sessions: {
        ...state.sessions,
        [event.sessionID]: { ...held, items: replace(held.items, event.terminal) },
      },
    })
  }

  if (event.type === "sessions.removed" && event.sessionIDs.some((id) => id in state.sessions))
    return changed({ ...state, sessions: omit(state.sessions, event.sessionIDs) })

  return unchanged(state)
}

function resting(state: Extract<State, { status: "unsupported" | "failed" }>, event: Event): Transition {
  if (event.type === "server.connected" || (event.type === "session.retry" && state.status === "failed"))
    return check(
      state.issued + 1,
      Object.fromEntries(state.sessions.map((id): [string, Held] => [id, { status: "waiting" }])),
      event.type === "server.connected" ? state.connections + 1 : state.connections,
    )

  if (event.type === "session.loaded" && !state.sessions.includes(event.sessionID))
    return changed({ ...state, sessions: [...state.sessions, event.sessionID] })

  if (event.type === "sessions.removed" && state.sessions.some((id) => event.sessionIDs.includes(id)))
    return changed({ ...state, sessions: state.sessions.filter((id) => !event.sessionIDs.includes(id)) })

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
    if (event.type === "list.unavailable")
      return changed({
        status: "unsupported",
        connections: state.connections,
        issued: state.issued,
        sessions: Object.keys(state.sessions),
      })

    // A failed refresh keeps the terminals already shown.
    if (list.status === "refreshing")
      return changed(put(state, event.sessionID, { status: "ready", connection: list.connection, items: list.items }))

    return changed(put(state, event.sessionID, { status: "failed", error: event.error }))
  }

  if (event.type === "terminal.updated" || event.type === "terminal.replaced") {
    if (!list) return unchanged(state)

    if ((list.status === "ready" || list.status === "refreshing") && listed(list.items, event.terminal.id))
      return changed(put(state, event.sessionID, { ...list, items: replace(list.items, event.terminal) }))

    // A terminal the list doesn't have yet arrives with the next list; this client changes only listed ones.
    return event.type === "terminal.updated" ? load(state, event.sessionID) : unchanged(state)
  }

  if (event.type === "terminal.created")
    return (list?.status === "ready" || list?.status === "refreshing") && !listed(list.items, event.terminal.id)
      ? changed(put(state, event.sessionID, { ...list, items: [...list.items, event.terminal] }))
      : unchanged(state)

  if (event.type === "sessions.removed" && event.sessionIDs.some((id) => id in state.sessions))
    return changed({ ...state, sessions: omit(state.sessions, event.sessionIDs) })

  return unchanged(state)
}

function load(state: Supported, sessionID: string): Transition {
  const attempt = state.issued + 1
  const list = state.sessions[sessionID]

  const next =
    list?.status === "ready" || list?.status === "refreshing"
      ? ({ status: "refreshing", connection: list.connection, items: list.items, attempt } satisfies List)
      : ({ status: "loading", attempt } satisfies List)

  return changed({ ...put(state, sessionID, next), issued: attempt }, [{ type: "load-list", sessionID, attempt }])
}

function check(attempt: number, sessions: Readonly<Record<string, Held>>, connections: number): Transition {
  return changed({ status: "checking", connections, attempt, sessions }, [{ type: "check-capability", attempt }])
}

function put(state: Supported, sessionID: string, list: List): Supported {
  return { ...state, sessions: { ...state.sessions, [sessionID]: list } }
}

function omit<T extends Held | List>(sessions: Readonly<Record<string, T>>, ids: readonly string[]) {
  return Object.fromEntries(Object.entries(sessions).filter(([id]) => !ids.includes(id)))
}

function listed(list: readonly PersistentPtyInfo[], id: string) {
  return list.some((info) => info.id === id)
}

function replace(list: readonly PersistentPtyInfo[], terminal: PersistentPtyInfo) {
  return list.map((info) => (info.id === terminal.id ? terminal : info))
}

function changed(state: State, commands: readonly Command[] = []): Transition {
  return { state, commands }
}

function unchanged(state: State): Transition {
  return { state, commands: [] }
}
