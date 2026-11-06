import type { VoiceEvent } from "./protocol"

/** Bounds the whole handshake: models, ICE gathering, SDP exchange, `session.started` and the microphone. */
export const JOIN_TIMEOUT = 35_000

/** How long a `disconnected` peer may take to recover before the call drops. */
export const DISCONNECT_GRACE = 5_000

/** Bounds the `session.close` -> `session.closed` handshake before the peer is closed anyway. */
export const CLOSE_TIMEOUT = 1_000

export const LEVEL_INTERVAL = 100

export type VoiceJoinFailure = "unavailable" | "microphone" | "connection"

export type VoiceJoinTarget = { id: string; title?: string }

type ConnectStep =
  /** Resuming audio, checking `voice.models` and setting the local offer. */
  | { type: "offer"; viewing: VoiceJoinTarget; tail: string }
  /** Waiting for ICE gathering to complete before the offer is sent. */
  | { type: "ice"; viewing: VoiceJoinTarget; tail: string }
  /** Posting the offer to `voice.session` and applying the answer. */
  | { type: "negotiating" }
  /** The answer is applied; waiting for `session.started` on the data channel. */
  | { type: "awaiting-started" }
  /** `session.started` arrived; acquiring the microphone. */
  | { type: "mic" }

/** `disconnectedAttempt` names the running grace timer of a `disconnected` peer; `seq` numbers those timers. */
type Link = { seq: number; disconnectedAttempt?: number }

type Connecting = { status: "connecting"; step: ConnectStep; sessionStarted: boolean } & Link

type Live = { status: "live" } & Link

export type VoiceTransportState =
  | { status: "idle" }
  | Connecting
  | Live
  /** `handshake` waits for `session.closed` after `session.close`; `releasing` closes the peer and audio. */
  | { status: "closing"; step: "handshake" | "releasing" }
  | { status: "closed" }

export type VoiceTransportEvent =
  | { type: "join"; viewing: VoiceJoinTarget; tail: string }
  | { type: "offer.ready"; iceComplete: boolean }
  | { type: "ice.complete" }
  | { type: "answer.applied" }
  | { type: "mic.ready" }
  | { type: "step.failed"; step: "offer" | "negotiating" | "mic"; reason: VoiceJoinFailure }
  | { type: "join.timeout" }
  | { type: "channel.closed" }
  | { type: "channel.message"; event: VoiceEvent }
  | { type: "peer.state"; state: RTCPeerConnectionState }
  | { type: "disconnect.timeout"; attempt: number }
  | { type: "track.received" }
  | { type: "audio.play.failed" }
  | { type: "close" }
  | { type: "close.timeout" }
  | { type: "peer.released" }

export type VoiceTransportEffect =
  | { type: "join.timer.start"; ms: number }
  | { type: "join.timer.clear" }
  | { type: "disconnect.timer.start"; attempt: number; ms: number }
  | { type: "disconnect.timer.clear" }
  | { type: "prepare.offer" }
  | { type: "negotiate"; viewing: VoiceJoinTarget; tail: string }
  | { type: "acquire.mic" }
  | { type: "attach.remote.track" }
  | { type: "meter.start"; ms: number }
  /** Stops the microphone, remote audio and level meter, and aborts the transport's requests. */
  | { type: "stop.media" }
  /** Sends `session.close`; dispatch `close.timeout` after `ms`. */
  | { type: "close.handshake.start"; ms: number }
  | { type: "close.timer.clear" }
  /** Closes the peer connection and audio context; dispatch `peer.released` once done. */
  | { type: "release.peer" }
  | { type: "forward.event"; event: VoiceEvent }
  | { type: "join.resolve" }
  | { type: "join.reject"; reason: VoiceJoinFailure }
  | { type: "notify.dropped" }
  | { type: "close.resolve" }

export type VoiceTransportTransition = {
  state: VoiceTransportState
  effects: VoiceTransportEffect[]
}

// Errors that end the Live session; any other error rejects one client event and leaves the call running.
const FATAL_ERROR_CODES = ["session_expired", "invalid_api_key", "insufficient_quota", "billing_hard_limit_reached"]

const FATAL_ERROR_TYPES = ["authentication_error", "permission_error"]

export function createVoiceTransportState(): VoiceTransportState {
  return { status: "idle" }
}

export function transitionVoiceTransport(
  state: VoiceTransportState,
  event: VoiceTransportEvent,
): VoiceTransportTransition {
  if (state.status === "idle") {
    if (event.type === "join")
      return {
        state: {
          status: "connecting",
          step: { type: "offer", viewing: event.viewing, tail: event.tail },
          sessionStarted: false,
          seq: 0,
        },
        effects: [{ type: "join.timer.start", ms: JOIN_TIMEOUT }, { type: "prepare.offer" }],
      }

    if (event.type === "close") return beginClose(state, false)

    return unchanged(state)
  }

  if (state.status === "connecting") return connecting(state, event)

  if (state.status === "live") return live(state, event)

  if (state.status === "closing") return closing(state, event)

  return unchanged(state)
}

/** The transport can still join; each transport joins once. */
export function canJoinVoiceTransport(state: VoiceTransportState) {
  return state.status === "idle"
}

/** A microphone granted now still belongs to this join. */
export function isAcquiringMicVoiceTransport(state: VoiceTransportState) {
  return state.status === "connecting" && state.step.type === "mic"
}

export function canSendVoiceTransport(state: VoiceTransportState) {
  return state.status === "live"
}

export function isFatalVoiceError(event: VoiceEvent) {
  if (event.type !== "error") return false

  return FATAL_ERROR_CODES.includes(event.error?.code ?? "") || FATAL_ERROR_TYPES.includes(event.error?.type ?? "")
}

function connecting(state: Connecting, event: VoiceTransportEvent): VoiceTransportTransition {
  const reject = (reason: VoiceJoinFailure): VoiceTransportEffect => ({ type: "join.reject", reason })
  const step = state.step

  if (event.type === "offer.ready") {
    if (step.type !== "offer") return unchanged(state)

    if (!event.iceComplete) return { state: { ...state, step: { ...step, type: "ice" } }, effects: [] }

    return negotiate(state, step)
  }

  if (event.type === "ice.complete") {
    if (step.type !== "ice") return unchanged(state)

    return negotiate(state, step)
  }

  if (event.type === "answer.applied") {
    if (step.type !== "negotiating") return unchanged(state)

    if (!state.sessionStarted) return { state: { ...state, step: { type: "awaiting-started" } }, effects: [] }

    return { state: { ...state, step: { type: "mic" } }, effects: [{ type: "acquire.mic" }] }
  }

  if (event.type === "mic.ready") {
    if (step.type !== "mic") return unchanged(state)

    return {
      state: { status: "live", seq: state.seq, disconnectedAttempt: state.disconnectedAttempt },
      effects: [{ type: "join.timer.clear" }, { type: "meter.start", ms: LEVEL_INTERVAL }, { type: "join.resolve" }],
    }
  }

  if (event.type === "step.failed") {
    if (step.type !== event.step) return unchanged(state)

    return beginClose(state, true, reject(event.reason))
  }

  if (event.type === "join.timeout" || event.type === "close" || event.type === "audio.play.failed")
    return beginClose(state, true, reject("connection"))

  if (event.type === "channel.closed") return beginClose(state, false, reject("connection"))

  if (event.type === "channel.message") {
    const message = event.event

    if (message.type === "session.closed") return beginClose(state, false, reject("connection"))

    // Nothing has worked yet, so any error means this join failed.
    if (message.type === "error") return beginClose(state, true, reject("connection"))

    if (message.type !== "session.started") return forward(state, message)

    if (step.type === "awaiting-started")
      return {
        state: { ...state, sessionStarted: true, step: { type: "mic" } },
        effects: [{ type: "acquire.mic" }, { type: "forward.event", event: message }],
      }

    return forward(state.sessionStarted ? state : { ...state, sessionStarted: true }, message)
  }

  return link(state, event, reject("connection"))
}

function live(state: Live, event: VoiceTransportEvent): VoiceTransportTransition {
  const dropped: VoiceTransportEffect = { type: "notify.dropped" }

  if (event.type === "channel.message") {
    const message = event.event

    if (message.type === "session.closed") return beginClose(state, false, dropped)

    if (isFatalVoiceError(message)) return beginClose(state, true, dropped)

    return forward(state, message)
  }

  if (event.type === "channel.closed") return beginClose(state, false, dropped)

  if (event.type === "audio.play.failed") return beginClose(state, true, dropped)

  if (event.type === "close") return beginClose(state, true)

  return link(state, event, dropped)
}

/** Peer connection state and the remote track, alike while connecting and live. */
function link(
  state: Connecting | Live,
  event: VoiceTransportEvent,
  exit: VoiceTransportEffect,
): VoiceTransportTransition {
  if (event.type === "track.received") return { state, effects: [{ type: "attach.remote.track" }] }

  if (event.type === "disconnect.timeout") {
    if (state.disconnectedAttempt !== event.attempt) return unchanged(state)

    return beginClose({ ...state, disconnectedAttempt: undefined }, true, exit)
  }

  if (event.type !== "peer.state") return unchanged(state)

  if (event.state === "failed" || event.state === "closed") return beginClose(state, false, exit)

  // ICE often recovers from `disconnected` on its own, after a network change or brief packet loss.
  if (event.state === "disconnected") {
    if (state.disconnectedAttempt !== undefined) return unchanged(state)
    const attempt = state.seq + 1

    return {
      state: { ...state, seq: attempt, disconnectedAttempt: attempt },
      effects: [{ type: "disconnect.timer.start", attempt, ms: DISCONNECT_GRACE }],
    }
  }

  if (state.disconnectedAttempt === undefined) return unchanged(state)

  return { state: { ...state, disconnectedAttempt: undefined }, effects: [{ type: "disconnect.timer.clear" }] }
}

function closing(
  state: Extract<VoiceTransportState, { status: "closing" }>,
  event: VoiceTransportEvent,
): VoiceTransportTransition {
  if (state.step === "releasing") {
    if (event.type !== "peer.released") return unchanged(state)

    return { state: { status: "closed" }, effects: [{ type: "close.resolve" }] }
  }

  if (event.type === "close.timeout")
    return { state: { ...state, step: "releasing" }, effects: [{ type: "release.peer" }] }

  if (
    event.type === "channel.closed" ||
    (event.type === "channel.message" && event.event.type === "session.closed") ||
    (event.type === "peer.state" && (event.state === "failed" || event.state === "closed"))
  )
    return {
      state: { ...state, step: "releasing" },
      effects: [{ type: "close.timer.clear" }, { type: "release.peer" }],
    }

  return unchanged(state)
}

/**
 * Stops media and closes the session. It says goodbye with `session.close` only to a started session whose
 * channel is still up; `canHandshake` is false when the session, channel or peer already closed.
 */
function beginClose(
  state: Exclude<VoiceTransportState, { status: "closing" | "closed" }>,
  canHandshake: boolean,
  exit?: VoiceTransportEffect,
): VoiceTransportTransition {
  const started = state.status === "live" || (state.status === "connecting" && state.sessionStarted)
  const handshake = canHandshake && started

  const effects: VoiceTransportEffect[] = [
    ...(state.status === "connecting" ? [{ type: "join.timer.clear" } as const] : []),
    ...(state.status !== "idle" && state.disconnectedAttempt !== undefined
      ? [{ type: "disconnect.timer.clear" } as const]
      : []),
    { type: "stop.media" },
    handshake ? { type: "close.handshake.start", ms: CLOSE_TIMEOUT } : { type: "release.peer" },
    ...(exit ? [exit] : []),
  ]

  return { state: { status: "closing", step: handshake ? "handshake" : "releasing" }, effects }
}

function negotiate(state: Connecting, step: { viewing: VoiceJoinTarget; tail: string }): VoiceTransportTransition {
  return {
    state: { ...state, step: { type: "negotiating" } },
    effects: [{ type: "negotiate", viewing: step.viewing, tail: step.tail }],
  }
}

function forward(state: Connecting | Live, event: VoiceEvent): VoiceTransportTransition {
  return { state, effects: [{ type: "forward.event", event }] }
}

function unchanged(state: VoiceTransportState): VoiceTransportTransition {
  return { state, effects: [] }
}
