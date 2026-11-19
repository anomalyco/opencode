import type { VoiceReply } from "./replies"

/** Bounds one session's history read; a hung read would otherwise stop every later announcement. */
export const FETCH_TIMEOUT = 15_000

/** The first retry of a failed history read; each later one waits twice as long. */
export const RETRY_DELAY = 1_000

/** Failed reads of one session retried before it waits for its next idle event. */
export const MAX_RETRIES = 4

export type HeardReply = { sessionID: string; messageID: string }

type Queue = {
  /** Each step takes a new attempt, so a late read, timer or announcement for an earlier step is ignored. */
  attempt: number
  connected: boolean
  delegating: boolean
  /** Sessions whose history should be read, oldest first. */
  sessions: readonly string[]
  /** Replies waiting to be announced, oldest first. */
  announcements: readonly VoiceReply[]
  /** Consecutive failed reads per session. */
  failures: Readonly<Record<string, number>>
  /** Sessions waiting for the backoff timer. */
  retry: readonly string[]
}

export type VoiceReplyState =
  | ({ status: "idle" } & Queue)
  | ({ status: "fetching"; sessionID: string } & Queue)
  /** Waiting for the speech gates to let the next announcement through. */
  | ({ status: "holding" } & Queue)
  | ({ status: "announcing" } & Queue)
  | ({ status: "backoff" } & Queue)

export type VoiceReplyEvent =
  /** The call's transport is live; `sessionIDs` are every session voice sent work to. */
  | { type: "call.connected"; sessionIDs: readonly string[] }
  | { type: "call.disconnected" }
  /** Announcements wait while a delegation is open, so they never talk over its answer. */
  | { type: "delegations.changed"; delegating: boolean }
  | { type: "sessions.dirty"; sessionIDs: readonly string[] }
  /** A delegation read these replies aloud. */
  | { type: "replies.heard"; heard: readonly HeardReply[] }
  | { type: "fetch.succeeded"; attempt: number; sessionID: string; replies: readonly VoiceReply[] }
  | { type: "fetch.failed"; attempt: number; sessionID: string }
  | { type: "gate.opened"; attempt: number }
  | { type: "retry.due"; attempt: number }
  | { type: "announce.succeeded"; attempt: number; reply: VoiceReply }
  | { type: "disposed" }

export type VoiceReplyEffect =
  /** Reads the session's history; dispatch `fetch.succeeded` or `fetch.failed`, failing after `timeout`. */
  | { type: "fetch"; attempt: number; sessionID: string; timeout: number }
  | { type: "fetch.abort" }
  /** Dispatch `gate.opened` once the speech gates allow an announcement. */
  | { type: "hold"; attempt: number }
  /** Dispatch `retry.due` after `ms`. */
  | { type: "retry"; attempt: number; ms: number }
  /** Cancels the pending `hold` or `retry`. */
  | { type: "wait.clear" }
  /** Sends the reply as Live commentary; dispatch `announce.succeeded` once it is sent. */
  | { type: "announce"; attempt: number; reply: VoiceReply }

export type VoiceReplyTransition = {
  state: VoiceReplyState
  effects: VoiceReplyEffect[]
}

export function createVoiceReplyState(attempt = 0): VoiceReplyState {
  return {
    status: "idle",
    attempt,
    connected: false,
    delegating: false,
    sessions: [],
    announcements: [],
    failures: {},
    retry: [],
  }
}

export function transitionVoiceReply(state: VoiceReplyState, event: VoiceReplyEvent): VoiceReplyTransition {
  if (event.type === "call.connected") {
    if (state.connected) return dirty(state, event.sessionIDs)

    return advance({ ...enqueue(queue(state), event.sessionIDs), connected: true }, [])
  }

  if (event.type === "call.disconnected") {
    if (!state.connected) return unchanged(state)

    return pause(state, { connected: false })
  }

  if (event.type === "delegations.changed") {
    if (event.delegating === state.delegating) return unchanged(state)

    // The commentary is already being sent; its result decides what follows.
    if (state.status === "announcing") return { state: { ...state, delegating: event.delegating }, effects: [] }

    if (event.delegating) return pause(state, { delegating: true })

    return advance({ ...queue(state), delegating: false }, [])
  }

  if (event.type === "sessions.dirty") return dirty(state, event.sessionIDs)

  if (event.type === "replies.heard") {
    const announcements = state.announcements.filter(
      (reply) => !event.heard.some((item) => item.sessionID === reply.sessionID && item.messageID === reply.messageID),
    )

    if (announcements.length === state.announcements.length) return unchanged(state)

    if (state.status === "holding" && !announcements.length)
      return advance({ ...queue(state), announcements }, [{ type: "wait.clear" }])

    return { state: { ...state, announcements }, effects: [] }
  }

  if (event.type === "fetch.succeeded" || event.type === "fetch.failed") {
    if (state.status !== "fetching" || state.attempt !== event.attempt || state.sessionID !== event.sessionID)
      return unchanged(state)
    const next = queue(state)

    if (event.type === "fetch.succeeded")
      return advance(
        {
          ...next,
          failures: omit(next.failures, event.sessionID),
          announcements: [
            ...next.announcements,
            ...event.replies.filter((reply) => !next.announcements.some((item) => same(item, reply))),
          ],
        },
        [],
      )
    const count = (next.failures[event.sessionID] ?? 0) + 1

    // A failing session waits for its own backoff; it never delays reads of the others.
    return advance(
      {
        ...next,
        sessions: next.sessions.filter((id) => id !== event.sessionID),
        failures: { ...next.failures, [event.sessionID]: count },
        retry:
          count <= MAX_RETRIES && !next.retry.includes(event.sessionID) ? [...next.retry, event.sessionID] : next.retry,
      },
      [],
    )
  }

  if (event.type === "gate.opened") {
    const reply = state.announcements[0]

    if (state.status !== "holding" || state.attempt !== event.attempt || !reply) return unchanged(state)

    return { state: { ...state, status: "announcing" }, effects: [{ type: "announce", attempt: state.attempt, reply }] }
  }

  if (event.type === "retry.due") {
    if (state.status !== "backoff" || state.attempt !== event.attempt) return unchanged(state)
    const next = queue(state)

    return advance(
      { ...next, sessions: [...next.sessions, ...next.retry.filter((id) => !next.sessions.includes(id))], retry: [] },
      [],
    )
  }

  if (event.type === "announce.succeeded") {
    // A sent reply is heard even when the call paused meanwhile; it must never be announced twice.
    const announcements = state.announcements.filter((reply) => !same(reply, event.reply))

    if (state.status === "announcing" && state.attempt === event.attempt)
      return advance({ ...queue(state), announcements }, [])

    if (announcements.length === state.announcements.length) return unchanged(state)

    return { state: { ...state, announcements }, effects: [] }
  }

  return { state: createVoiceReplyState(state.attempt + 1), effects: stop(state) }
}

/** One bounded append per reply keeps attribution with its content and stays below Live's 500-token append limit. */
export function replyCommentary(reply: VoiceReply) {
  const text = reply.text.replace(/```[\s\S]*?```/g, "[code in session]").slice(0, 800)

  return `Result from session ${JSON.stringify(reply.title.slice(0, 100))}, request ${JSON.stringify(reply.instruction.slice(0, 100))}: ${text}`
}

/** Starts the next step when none is running: announcements first, then reads, then retries. */
function advance(next: Queue, effects: VoiceReplyEffect[]): VoiceReplyTransition {
  if (!next.connected || next.delegating) return { state: { status: "idle", ...next }, effects }
  const attempt = next.attempt + 1

  if (next.announcements.length)
    return { state: { status: "holding", ...next, attempt }, effects: [...effects, { type: "hold", attempt }] }
  const [sessionID, ...sessions] = next.sessions

  if (sessionID)
    return {
      state: { status: "fetching", ...next, attempt, sessionID, sessions },
      effects: [...effects, { type: "fetch", attempt, sessionID, timeout: FETCH_TIMEOUT }],
    }

  if (next.retry.length) {
    const failures = Math.min(...next.retry.map((id) => next.failures[id] ?? 1))

    return {
      state: { status: "backoff", ...next, attempt },
      effects: [...effects, { type: "retry", attempt, ms: RETRY_DELAY * 2 ** (failures - 1) }],
    }
  }

  return { state: { status: "idle", ...next }, effects }
}

function dirty(state: VoiceReplyState, sessionIDs: readonly string[]): VoiceReplyTransition {
  const next = enqueue(queue(state), sessionIDs)

  if (
    next.sessions.length === state.sessions.length &&
    next.retry.length === state.retry.length &&
    Object.keys(next.failures).length === Object.keys(state.failures).length
  )
    return unchanged(state)

  if (state.status === "idle") return advance(next, [])

  // A healthy session is read now rather than after another session's backoff.
  if (state.status === "backoff") return advance(next, [{ type: "wait.clear" }])

  return { state: { ...state, ...next }, effects: [] }
}

/** A fresh idle event clears a session's failures, and a session being read is read once more after it. */
function enqueue(next: Queue, sessionIDs: readonly string[]): Queue {
  return {
    ...next,
    sessions: [
      ...next.sessions,
      ...sessionIDs.filter((id, index) => !next.sessions.includes(id) && sessionIDs.indexOf(id) === index),
    ],
    failures: sessionIDs.reduce(omit, next.failures),
    retry: next.retry.filter((id) => !sessionIDs.includes(id)),
  }
}

function pause(state: VoiceReplyState, patch: Partial<Queue>): VoiceReplyTransition {
  const next = queue(state)

  return {
    state: {
      status: "idle",
      ...next,
      ...patch,
      attempt: state.attempt + 1,
      // An interrupted read starts again once the call can announce.
      sessions: state.status === "fetching" ? [state.sessionID, ...next.sessions] : next.sessions,
    },
    effects: stop(state),
  }
}

function stop(state: VoiceReplyState): VoiceReplyEffect[] {
  if (state.status === "fetching") return [{ type: "fetch.abort" }]

  if (state.status === "holding" || state.status === "backoff") return [{ type: "wait.clear" }]

  return []
}

function queue(state: VoiceReplyState): Queue {
  return {
    attempt: state.attempt,
    connected: state.connected,
    delegating: state.delegating,
    sessions: state.sessions,
    announcements: state.announcements,
    failures: state.failures,
    retry: state.retry,
  }
}

function omit(failures: Readonly<Record<string, number>>, sessionID: string) {
  if (!(sessionID in failures)) return failures
  const next = { ...failures }
  delete next[sessionID]

  return next
}

function same(a: VoiceReply, b: VoiceReply) {
  return a.sessionID === b.sessionID && a.messageID === b.messageID
}

function unchanged(state: VoiceReplyState): VoiceReplyTransition {
  return { state, effects: [] }
}
