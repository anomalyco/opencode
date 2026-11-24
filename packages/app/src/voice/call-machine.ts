import type { ServerConnection } from "@/runtime/server/registry"
import type { VoiceFailure } from "./transport"

/** Bounds the module load, microphone prompt, active-call IPC and WebRTC join; above the join's own 35 s timeout. */
export const CONNECT_TIMEOUT = 45_000

/** Bounds the teardown before Call is offered again; above the transport's 1 s close handshake. */
export const END_TIMEOUT = 2_000

export const MAX_CAPTIONS = 4

export type VoiceFailureReason = VoiceFailure["reason"]

export type VoiceSpeaker = "user" | "assistant"

export type VoiceCaption = { utterance: number; speaker: VoiceSpeaker; text: string }

export type VoiceViewedSession = { id: string; title?: string }

/** What a call keeps from Call until End, across drops and Rejoin. */
type Call<TCtx> = {
  attempt: number
  server: ServerConnection.Key
  ctx: TCtx
  viewing: VoiceViewedSession
  muted: boolean
  captions: readonly VoiceCaption[]
}

export type VoiceCallState<TCtx = unknown> =
  | { status: "idle"; attempt: number }
  /** `joined` is the session the backend was given; navigation while connecting syncs it once connected. */
  | ({ status: "connecting"; joined: VoiceViewedSession } & Call<TCtx>)
  | ({ status: "connected"; level: number } & Call<TCtx>)
  | ({ status: "dropped"; failure: VoiceFailureReason } & Call<TCtx>)
  /** End was pressed; Call stays unavailable until the previous call's audio and IPC are released. */
  | { status: "ending"; attempt: number }

export type VoiceCallEvent<TCtx = unknown> =
  | { type: "start"; server: ServerConnection.Key; ctx: TCtx; session: VoiceViewedSession }
  | { type: "rejoin" }
  | { type: "end" }
  | { type: "disposed" }
  | { type: "mute.toggled" }
  | { type: "session.viewed"; server: ServerConnection.Key; session: VoiceViewedSession }
  | { type: "connect.succeeded"; attempt: number }
  | { type: "connect.failed"; attempt: number; failure: VoiceFailureReason }
  | { type: "connect.timeout"; attempt: number }
  /** The transport closed, or a send on it failed. */
  | { type: "call.dropped"; attempt: number; failure: VoiceFailureReason }
  | { type: "level.updated"; attempt: number; mic: number; speaker: number }
  | { type: "caption.updated"; attempt: number; utterance: number; speaker: VoiceSpeaker; text: string }
  | { type: "end.settled"; attempt: number }
  | { type: "end.timeout"; attempt: number }

export type VoiceCallEffect<TCtx = unknown> =
  /** Opens a transport; dispatch `connect.succeeded` or `connect.failed`, and `connect.timeout` after `timeout`. */
  | {
      type: "connect"
      attempt: number
      server: ServerConnection.Key
      ctx: TCtx
      viewing: VoiceViewedSession
      muted: boolean
      timeout: number
    }
  /** The transport is live; `sync` is a session the user moved to while it connected. */
  | { type: "activate"; attempt: number; sync?: VoiceViewedSession }
  | { type: "instructions"; attempt: number; viewing: VoiceViewedSession }
  | { type: "mute"; attempt: number; muted: boolean }
  /** Closes the dropped attempt's transport; the call keeps its delegation-free state for Rejoin. */
  | { type: "disconnect"; attempt: number }
  /** Releases the whole call; dispatch `end.settled` once done, or `end.timeout` after `timeout`. */
  | { type: "teardown"; attempt: number; timeout: number }

export type VoiceCallTransition<TCtx = unknown> = {
  state: VoiceCallState<TCtx>
  effects: VoiceCallEffect<TCtx>[]
}

export type VoiceCallView = {
  canStart: boolean
  panelOpen: boolean
  connecting: boolean
  canMute: boolean
  canRejoin: boolean
  muted: boolean
  level: number
  title: string
  failure: VoiceFailureReason | undefined
  captions: readonly VoiceCaption[]
  latestCaption: VoiceCaption | undefined
}

type Active<TCtx> = Exclude<VoiceCallState<TCtx>, { status: "idle" | "ending" }>

const NO_CAPTIONS: readonly VoiceCaption[] = []

export function createVoiceCallState<TCtx = unknown>(): VoiceCallState<TCtx> {
  return { status: "idle", attempt: 0 }
}

export function transitionVoiceCall<TCtx>(
  state: VoiceCallState<TCtx>,
  event: VoiceCallEvent<TCtx>,
): VoiceCallTransition<TCtx> {
  if (event.type === "start") {
    if (state.status !== "idle") return unchanged(state)

    return connect({
      attempt: state.attempt + 1,
      server: event.server,
      ctx: event.ctx,
      viewing: event.session,
      muted: false,
      captions: NO_CAPTIONS,
    })
  }

  if (event.type === "rejoin") {
    if (state.status !== "dropped") return unchanged(state)

    return connect({ ...call(state), attempt: state.attempt + 1 })
  }

  if (event.type === "end") {
    if (state.status === "idle" || state.status === "ending") return unchanged(state)
    const attempt = state.attempt + 1

    return { state: { status: "ending", attempt }, effects: [{ type: "teardown", attempt, timeout: END_TIMEOUT }] }
  }

  if (event.type === "disposed") {
    if (state.status === "idle") return unchanged(state)
    const attempt = state.attempt + 1

    // An ending call is already tearing down.
    if (state.status === "ending") return { state: { status: "idle", attempt }, effects: [] }

    return { state: { status: "idle", attempt }, effects: [{ type: "teardown", attempt, timeout: END_TIMEOUT }] }
  }

  if (event.type === "end.settled" || event.type === "end.timeout") {
    if (state.status !== "ending" || state.attempt !== event.attempt) return unchanged(state)

    return { state: { status: "idle", attempt: state.attempt }, effects: [] }
  }

  if (event.type === "session.viewed") {
    if (
      state.status === "idle" ||
      state.status === "ending" ||
      state.server !== event.server ||
      sameSession(state.viewing, event.session)
    )
      return unchanged(state)
    const next = { ...state, viewing: event.session }

    if (next.status !== "connected") return { state: next, effects: [] }

    return { state: next, effects: [{ type: "instructions", attempt: next.attempt, viewing: event.session }] }
  }

  if (event.type === "mute.toggled") {
    if (state.status !== "connected") return unchanged(state)

    return {
      state: { ...state, muted: !state.muted },
      effects: [{ type: "mute", attempt: state.attempt, muted: !state.muted }],
    }
  }

  if (state.status === "idle" || state.status === "ending" || state.attempt !== event.attempt) return unchanged(state)

  if (event.type === "connect.succeeded") {
    if (state.status !== "connecting") return unchanged(state)

    return {
      state: { status: "connected", ...call(state), level: 0 },
      effects: [
        {
          type: "activate",
          attempt: state.attempt,
          sync: sameSession(state.joined, state.viewing) ? undefined : state.viewing,
        },
      ],
    }
  }

  if (event.type === "connect.failed" || event.type === "connect.timeout") {
    if (state.status !== "connecting") return unchanged(state)

    return drop(state, event.type === "connect.failed" ? event.failure : "connection")
  }

  if (event.type === "call.dropped") {
    // The first failure wins: the close it causes makes the join and later sends fail too.
    if (state.status === "dropped") return unchanged(state)

    return drop(state, event.failure)
  }

  if (event.type === "level.updated") {
    if (state.status !== "connected") return unchanged(state)
    const level = Math.min(1, (state.muted ? event.speaker : Math.max(event.mic, event.speaker)) * 5)

    if (level === state.level) return unchanged(state)

    return { state: { ...state, level }, effects: [] }
  }

  if (state.status === "dropped" || !event.text) return unchanged(state)
  const last = state.captions.at(-1)

  // Each utterance grows in place; the next one starts a new line.
  if (last?.utterance === event.utterance) {
    if (last.text === event.text) return unchanged(state)

    return {
      state: { ...state, captions: [...state.captions.slice(0, -1), { ...last, text: event.text }] },
      effects: [],
    }
  }

  return {
    state: {
      ...state,
      captions: [...state.captions, { utterance: event.utterance, speaker: event.speaker, text: event.text }].slice(
        -MAX_CAPTIONS,
      ),
    },
    effects: [],
  }
}

export function voiceCallView(state: VoiceCallState): VoiceCallView {
  if (state.status === "idle" || state.status === "ending")
    return {
      canStart: state.status === "idle",
      panelOpen: false,
      connecting: false,
      canMute: false,
      canRejoin: false,
      muted: false,
      level: 0,
      title: "",
      failure: undefined,
      captions: NO_CAPTIONS,
      latestCaption: undefined,
    }

  return {
    canStart: false,
    panelOpen: true,
    connecting: state.status === "connecting",
    canMute: state.status === "connected",
    canRejoin: state.status === "dropped",
    muted: state.muted,
    level: state.status === "connected" ? state.level : 0,
    title: state.viewing.title ?? state.viewing.id,
    failure: state.status === "dropped" ? state.failure : undefined,
    captions: state.captions,
    latestCaption: state.captions.at(-1),
  }
}

/** The session voice treats as on screen, while a call is open. */
export function viewedSession(state: VoiceCallState) {
  if (state.status === "idle" || state.status === "ending") return undefined

  return state.viewing
}

export function isMuted(state: VoiceCallState) {
  return state.status !== "idle" && state.status !== "ending" && state.muted
}

export function isConnecting(state: VoiceCallState, attempt: number) {
  return state.status === "connecting" && state.attempt === attempt
}

export function isConnected(state: VoiceCallState) {
  return state.status === "connected"
}

function connect<TCtx>(next: Call<TCtx>): VoiceCallTransition<TCtx> {
  return {
    state: { status: "connecting", ...next, joined: next.viewing },
    effects: [
      {
        type: "connect",
        attempt: next.attempt,
        server: next.server,
        ctx: next.ctx,
        viewing: next.viewing,
        muted: next.muted,
        timeout: CONNECT_TIMEOUT,
      },
    ],
  }
}

function drop<TCtx>(state: Active<TCtx>, failure: VoiceFailureReason): VoiceCallTransition<TCtx> {
  return {
    state: { status: "dropped", ...call(state), failure },
    effects: [{ type: "disconnect", attempt: state.attempt }],
  }
}

function call<TCtx>(state: Active<TCtx>): Call<TCtx> {
  return {
    attempt: state.attempt,
    server: state.server,
    ctx: state.ctx,
    viewing: state.viewing,
    muted: state.muted,
    captions: state.captions,
  }
}

function sameSession(a: VoiceViewedSession, b: VoiceViewedSession) {
  return a.id === b.id && a.title === b.title
}

function unchanged<TCtx>(state: VoiceCallState<TCtx>): VoiceCallTransition<TCtx> {
  return { state, effects: [] }
}
