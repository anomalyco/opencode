// Adapted from voice-lab's QuietGate. User speech is never subject to the chatter cap; a held announcement may
// interrupt only the agent, and only after holding for five seconds.

/** Quiet after either side speaks before an announcement may start. */
export const USER_QUIET_MS = 900
/** Quiet after the user speaks last, so they can carry on their turn. */
export const USER_TURN_QUIET_MS = 1_500
export const ASSISTANT_QUIET_MS = 900
/** Assistant speech starting this soon after a delegation answer is that answer. */
export const ANSWER_START_MS = 1_200
/** How long an answer that started is protected from the chatter cap. */
export const ANSWER_PROTECT_MS = 15_000
/** How long a held announcement waits on assistant chatter before it may interrupt. */
export const CHATTER_CAP_MS = 5_000

export type VoiceSpeechActivity =
  /** `endedAt` is when speech last stopped. */
  | { readonly status: "silent"; readonly endedAt: number }
  /** `at` is the latest moment speech was heard. */
  | { readonly status: "speaking"; readonly at: number }

export type VoiceAnswerWindow =
  | { readonly status: "none" }
  /** An answer was just sent; assistant speech starting within `ANSWER_START_MS` claims the protected window. */
  | { readonly status: "starting"; readonly at: number }
  /** The answer started speaking in time; it is protected from the chatter cap for `ANSWER_PROTECT_MS`. */
  | { readonly status: "speaking"; readonly at: number }

type VoiceGateTracks = {
  readonly user: VoiceSpeechActivity
  readonly assistant: VoiceSpeechActivity
  readonly answer: VoiceAnswerWindow
}

export type VoiceGateState =
  | ({ readonly status: "open" } & VoiceGateTracks)
  /** A session reply waits to be announced; `heldAt` starts its chatter cap. */
  | ({ readonly status: "holding"; readonly heldAt: number } & VoiceGateTracks)

export type VoiceGateEvent =
  /** One meter tick. */
  | { readonly type: "speech"; readonly user: boolean; readonly assistant: boolean; readonly now: number }
  /** A transcript delta: that side is speaking now. */
  | { readonly type: "heard"; readonly speaker: "user" | "assistant"; readonly now: number }
  /** A delegation's answer was sent. */
  | { readonly type: "answer"; readonly now: number }
  /** A session reply starts holding; restarts the chatter cap. */
  | { readonly type: "hold"; readonly now: number }
  /** The held reply was abandoned. */
  | { readonly type: "release" }
  /** The held reply was announced: release the hold and give the announcement time to start. */
  | { readonly type: "announced"; readonly now: number }
  | { readonly type: "reset" }

const SILENT: VoiceSpeechActivity = Object.freeze({ status: "silent", endedAt: -Infinity })
const NO_ANSWER: VoiceAnswerWindow = Object.freeze({ status: "none" })

export const INITIAL_VOICE_GATE_STATE: VoiceGateState = Object.freeze({
  status: "open",
  user: SILENT,
  assistant: SILENT,
  answer: NO_ANSWER,
})

export function transitionVoiceGate(state: VoiceGateState, event: VoiceGateEvent): VoiceGateState {
  if (event.type === "reset") return INITIAL_VOICE_GATE_STATE

  if (event.type === "speech")
    return tracks(
      state,
      activity(state.user, event.user, event.now),
      activity(state.assistant, event.assistant, event.now),
      answer(state.answer, event.assistant, event.now),
    )

  if (event.type === "heard" && event.speaker === "user")
    return tracks(state, activity(state.user, true, event.now), state.assistant, state.answer)

  if (event.type === "heard")
    return tracks(state, state.user, activity(state.assistant, true, event.now), answer(state.answer, true, event.now))

  if (event.type === "answer") return { ...state, answer: { status: "starting", at: event.now } }

  if (event.type === "hold") {
    if (state.status === "holding" && state.heldAt === event.now) return state

    return { status: "holding", heldAt: event.now, user: state.user, assistant: state.assistant, answer: state.answer }
  }

  if (event.type === "release") {
    if (state.status === "open") return state

    return { status: "open", user: state.user, assistant: state.assistant, answer: state.answer }
  }

  return { status: "open", user: state.user, assistant: state.assistant, answer: { status: "starting", at: event.now } }
}

/** How long an announcement must still wait; reading it changes nothing. */
export function voiceGateDelay(state: VoiceGateState, now: number) {
  if (state.user.status === "speaking") return USER_QUIET_MS
  const userAt = state.user.endedAt
  const assistantAt = state.assistant.status === "speaking" ? state.assistant.at : state.assistant.endedAt
  const user = (userAt > assistantAt ? USER_TURN_QUIET_MS : USER_QUIET_MS) - (now - userAt)

  if (user > 0) return user
  const window = state.answer

  if (window.status === "starting" && now - window.at < ANSWER_START_MS) return ANSWER_START_MS - (now - window.at)

  if (window.status === "speaking" && state.assistant.status === "speaking" && now - window.at < ANSWER_PROTECT_MS)
    return ANSWER_PROTECT_MS - (now - window.at)

  if (state.status === "holding" && now - state.heldAt >= CHATTER_CAP_MS) return 0

  if (state.assistant.status === "speaking") return ASSISTANT_QUIET_MS

  return Math.max(0, ASSISTANT_QUIET_MS - (now - assistantAt))
}

function activity(current: VoiceSpeechActivity, speaking: boolean, now: number): VoiceSpeechActivity {
  if (speaking) return current.status === "speaking" && current.at === now ? current : { status: "speaking", at: now }

  // Silence while silent is every quiet meter tick: keep the same object.
  return current.status === "silent" ? current : { status: "silent", endedAt: now }
}

function answer(window: VoiceAnswerWindow, assistantSpeaking: boolean, now: number): VoiceAnswerWindow {
  if (assistantSpeaking && window.status === "starting" && now - window.at < ANSWER_START_MS)
    return { status: "speaking", at: window.at }

  return window
}

function tracks(
  state: VoiceGateState,
  user: VoiceSpeechActivity,
  assistant: VoiceSpeechActivity,
  window: VoiceAnswerWindow,
): VoiceGateState {
  if (user === state.user && assistant === state.assistant && window === state.answer) return state

  return { ...state, user, assistant, answer: window }
}
