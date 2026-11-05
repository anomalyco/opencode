import type { ModelRef, SessionMessageUser } from "@opencode/client/promise"

/** How long a connected stream may lag a settled send before the client syncs instead of waiting for its echo. */
export const HANDOFF_ECHO_TIMEOUT_MS = 1_000

/** The bound on a send in flight, and on waiting for a disconnected stream to reconnect. */
export const HANDOFF_SEND_TIMEOUT_MS = 30_000

/** The bound on the sync that replaces a missed admission echo. */
export const HANDOFF_SYNC_TIMEOUT_MS = 10_000

// A submitted prompt the timeline shows before the server admits it, with the agent and model it was sent with.
export type SessionMessageHandoff = {
  readonly message: SessionMessageUser
  readonly selection: { readonly agent: string; readonly model: ModelRef }
}

/**
 * One session's optimistic prompt, held until the server's admission echo.
 * - `sending`: the selection, a staged revert and the admission are still in flight.
 * - `awaiting-echo`: the send settled as admitted; the echo is due on the event stream, or after it reconnects.
 * - `syncing`: the echo was missed; the session, its inbox and its messages reload before the handoff ends.
 */
export type HeldSessionHandoff = {
  readonly phase: "sending" | "awaiting-echo" | "syncing"
  readonly attempt: number
  readonly handoff: SessionMessageHandoff
}

export type SessionHandoffState =
  | {
      readonly status: "active"
      readonly connected: boolean
      // Never resets, so a timer or sync of an earlier handoff cannot match a later one on the same session.
      readonly issued: number
      readonly entries: Readonly<Record<string, HeldSessionHandoff>>
    }
  | { readonly status: "disposed" }

export type SessionHandoffEvent =
  | { readonly type: "handoff.set"; readonly sessionID: string; readonly handoff: SessionMessageHandoff }
  | { readonly type: "prompt.settled"; readonly sessionID: string; readonly messageID: string }
  | { readonly type: "handoff.cleared"; readonly sessionID: string; readonly messageID: string }
  | { readonly type: "session.reverted"; readonly sessionID: string; readonly boundary: string }
  | { readonly type: "session.deleted"; readonly sessionID: string }
  | { readonly type: "connection.changed"; readonly connected: boolean }
  | { readonly type: "sending.timed-out"; readonly sessionID: string; readonly attempt: number }
  | { readonly type: "echo.timed-out"; readonly sessionID: string; readonly attempt: number }
  | { readonly type: "sync.settled"; readonly sessionID: string; readonly attempt: number }
  | { readonly type: "sync.timed-out"; readonly sessionID: string; readonly attempt: number }
  | { readonly type: "disposed" }

export type SessionHandoffTimer = "sending" | "echo" | "sync"

export type SessionHandoffEffect =
  | {
      readonly type: "timer.set"
      readonly sessionID: string
      readonly timer: SessionHandoffTimer
      readonly attempt: number
      readonly delayMs: number
    }
  | { readonly type: "timer.cancel"; readonly sessionID: string }
  | { readonly type: "timer.cancel-all" }
  | { readonly type: "sync"; readonly sessionID: string; readonly attempt: number }

export type SessionHandoffTransition = {
  readonly state: SessionHandoffState
  readonly effects: readonly SessionHandoffEffect[]
}

// A factory rather than a shared constant, so no two drivers ever hold the same state object.
export function createSessionHandoffState(connected = true): SessionHandoffState {
  return { status: "active", connected, issued: 0, entries: {} }
}

export function transitionSessionHandoff(
  state: SessionHandoffState,
  event: SessionHandoffEvent,
): SessionHandoffTransition {
  if (state.status === "disposed") return { state, effects: [] }

  if (event.type === "disposed")
    return {
      state: { status: "disposed" },
      effects: Object.keys(state.entries).length > 0 ? [{ type: "timer.cancel-all" }] : [],
    }

  if (event.type === "connection.changed") return changeConnection(state, event.connected)

  const entry = state.entries[event.sessionID]

  if (event.type === "handoff.set") {
    const attempt = state.issued + 1

    return {
      state: {
        ...state,
        issued: attempt,
        entries: { ...state.entries, [event.sessionID]: { phase: "sending", attempt, handoff: event.handoff } },
      },
      effects: [
        { type: "timer.set", sessionID: event.sessionID, timer: "sending", attempt, delayMs: HANDOFF_SEND_TIMEOUT_MS },
      ],
    }
  }

  if (!entry) return { state, effects: [] }

  const messageID = entry.handoff.message.id

  if (event.type === "prompt.settled") {
    if (entry.phase !== "sending" || messageID !== event.messageID) return { state, effects: [] }
    const attempt = state.issued + 1

    return {
      state: {
        ...state,
        issued: attempt,
        entries: { ...state.entries, [event.sessionID]: { phase: "awaiting-echo", attempt, handoff: entry.handoff } },
      },
      effects: [
        {
          type: "timer.set",
          sessionID: event.sessionID,
          timer: "echo",
          attempt,
          delayMs: state.connected ? HANDOFF_ECHO_TIMEOUT_MS : HANDOFF_SEND_TIMEOUT_MS,
        },
      ],
    }
  }

  if (event.type === "handoff.cleared")
    return messageID === event.messageID ? clear(state, event.sessionID) : { state, effects: [] }

  // A revert staged at or before the prompt hides it, so the handoff must not bring it back.
  if (event.type === "session.reverted")
    return event.boundary <= messageID ? clear(state, event.sessionID) : { state, effects: [] }

  if (event.type === "session.deleted") return clear(state, event.sessionID)

  if (entry.attempt !== event.attempt) return { state, effects: [] }

  if (event.type === "sending.timed-out" || event.type === "echo.timed-out") {
    if (entry.phase !== (event.type === "sending.timed-out" ? "sending" : "awaiting-echo"))
      return { state, effects: [] }

    // A sync could not reach a disconnected server; the timer already bounded the wait.
    if (!state.connected) return { state: { ...state, entries: without(state.entries, event.sessionID) }, effects: [] }

    return startSync(state, event.sessionID, entry.handoff)
  }

  if (entry.phase !== "syncing") return { state, effects: [] }

  if (event.type === "sync.settled") return clear(state, event.sessionID)

  return { state: { ...state, entries: without(state.entries, event.sessionID) }, effects: [] }
}

export function selectSessionHandoff(state: SessionHandoffState, sessionID: string | undefined) {
  if (state.status !== "active" || !sessionID) return undefined

  return state.entries[sessionID]?.handoff
}

function changeConnection(
  state: Extract<SessionHandoffState, { status: "active" }>,
  connected: boolean,
): SessionHandoffTransition {
  if (state.connected === connected) return { state, effects: [] }
  const waiting = Object.entries(state.entries).filter(([, entry]) => entry.phase === "awaiting-echo")

  if (waiting.length === 0) return { state: { ...state, connected }, effects: [] }

  // A dropped stream may lose the echo: wait for the reconnect. A reconnect may already have lost it: sync now.
  const entries = { ...state.entries }

  const effects = waiting.flatMap(([sessionID, entry]): SessionHandoffEffect[] => {
    entries[sessionID] = {
      phase: connected ? "syncing" : "awaiting-echo",
      attempt: entry.attempt,
      handoff: entry.handoff,
    }

    if (!connected)
      return [{ type: "timer.set", sessionID, timer: "echo", attempt: entry.attempt, delayMs: HANDOFF_SEND_TIMEOUT_MS }]

    return [
      { type: "sync", sessionID, attempt: entry.attempt },
      { type: "timer.set", sessionID, timer: "sync", attempt: entry.attempt, delayMs: HANDOFF_SYNC_TIMEOUT_MS },
    ]
  })

  return { state: { ...state, connected, entries }, effects }
}

function startSync(
  state: Extract<SessionHandoffState, { status: "active" }>,
  sessionID: string,
  handoff: SessionMessageHandoff,
): SessionHandoffTransition {
  const attempt = state.issued + 1

  return {
    state: {
      ...state,
      issued: attempt,
      entries: { ...state.entries, [sessionID]: { phase: "syncing", attempt, handoff } },
    },
    effects: [
      { type: "sync", sessionID, attempt },
      { type: "timer.set", sessionID, timer: "sync", attempt, delayMs: HANDOFF_SYNC_TIMEOUT_MS },
    ],
  }
}

function clear(state: Extract<SessionHandoffState, { status: "active" }>, sessionID: string): SessionHandoffTransition {
  return {
    state: { ...state, entries: without(state.entries, sessionID) },
    effects: [{ type: "timer.cancel", sessionID }],
  }
}

function without(entries: Readonly<Record<string, HeldSessionHandoff>>, sessionID: string) {
  const next = { ...entries }
  delete next[sessionID]

  return next
}
