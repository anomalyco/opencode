import type { ToolCall } from "./protocol"

export const MAX_ROUNDS = 50

/** How long the delegator has to finish a response, from the delegation or from the tool outputs that resume it. */
export const RESPONSE_TIMEOUT = 60_000

/** Each tool call in a round gets this long; above wait_for_session's 90 s server wait. */
export const TOOL_TIMEOUT = 100_000

/** The output of each call in a round that ran past its deadline. */
export const TIMED_OUT = JSON.stringify({
  error: "Tool request timed out. Do not claim it succeeded or resend an uncertain admission.",
})

export type ToolOutput = { call_id: string; output: string }

export type DelegationPhase =
  /** Waiting for the delegator's response to finish, collecting the function calls it makes. */
  | { type: "responding"; attempt: number; responseID?: string; calls: readonly ToolCall[] }
  /** Running the previous response's function calls locally; Live waits for an output for each pending call. */
  | { type: "running"; attempt: number; pending: readonly string[] }

export type Delegation = {
  id: string
  /** The session tools default to; open_session moves it. */
  sessionID: string
  transcript: string[]
  rounds: number
  /** Every function call this delegation has received, so a replayed item never runs twice. */
  callIDs: readonly string[]
  phase: DelegationPhase
}

export type VoiceDelegationState = {
  /** The last attempt ID. Each phase takes a new one, so a late timer or round for an earlier phase is ignored. */
  seq: number
  /** Open delegations, oldest first. */
  delegations: readonly Delegation[]
  /** Responses that already finished; Live may repeat a terminal event. */
  finished: readonly string[]
}

export type ResponseOutcome = "completed" | "failed" | "incomplete" | "cancelled"

/** Response events name their delegation, or leave `delegationID` empty when Live does not know it. */
type Routed = { delegationID?: string | null; responseID?: string }

export type VoiceDelegationEvent =
  | { type: "delegation.created"; id: string; sessionID: string; transcript: string[] }
  | ({ type: "response.created" } & Routed)
  | ({ type: "response.call"; call: ToolCall } & Routed)
  | ({ type: "response.finished"; outcome: ResponseOutcome } & Routed)
  | { type: "round.completed"; id: string; attempt: number; sessionID: string; outputs: readonly ToolOutput[] }
  /** `channelOpen` is whether Live's data channel can still take tool outputs when the timer fires. */
  | { type: "delegation.timeout"; id: string; attempt: number; channelOpen: boolean }
  | { type: "call.reset" }

export type VoiceDelegationEffect =
  /** Replaces the delegation's timer; when it fires, dispatch `delegation.timeout` with this attempt. */
  | { type: "deadline"; id: string; attempt: number; ms: number }
  /** Runs the calls in order, then dispatches `round.completed` with this attempt. */
  | {
      type: "round"
      id: string
      attempt: number
      request: { id: string; sessionID: string; transcript: string[] }
      calls: readonly ToolCall[]
    }
  /** Aborts the delegation's running tools; the machine already ignores their round. */
  | { type: "abort"; id: string }
  /** Sends the outputs to Live and asks the delegator to continue. */
  | { type: "outputs"; outputs: readonly ToolOutput[] }
  /** Clears the delegation's timer and tools. An answered transcript is spent; a discarded one is offered again. */
  | { type: "finish"; id: string; outcome: "answered" | "discarded" }

export type VoiceDelegationTransition = {
  state: VoiceDelegationState
  effects: VoiceDelegationEffect[]
}

export function createVoiceDelegationState(): VoiceDelegationState {
  return { seq: 0, delegations: [], finished: [] }
}

export function hasDelegation(state: VoiceDelegationState, id: string) {
  return state.delegations.some((delegation) => delegation.id === id)
}

/** Session replies wait while any delegation is open, so they never talk over its answer. */
export function delegating(state: VoiceDelegationState) {
  return state.delegations.length > 0
}

export function transitionVoiceDelegation(
  state: VoiceDelegationState,
  event: VoiceDelegationEvent,
): VoiceDelegationTransition {
  if (event.type === "delegation.created") {
    if (hasDelegation(state, event.id)) return unchanged(state)
    const attempt = state.seq + 1

    return {
      state: {
        ...state,
        seq: attempt,
        delegations: [
          ...state.delegations,
          {
            id: event.id,
            sessionID: event.sessionID,
            transcript: event.transcript,
            rounds: 0,
            callIDs: [],
            phase: { type: "responding", attempt, calls: [] },
          },
        ],
      },
      effects: [{ type: "deadline", id: event.id, attempt, ms: RESPONSE_TIMEOUT }],
    }
  }

  if (event.type === "call.reset")
    return {
      state: { ...state, delegations: [] },
      effects: state.delegations.map(
        (delegation): VoiceDelegationEffect => ({ type: "finish", id: delegation.id, outcome: "discarded" }),
      ),
    }

  if (event.type === "delegation.timeout") {
    const delegation = state.delegations.find((item) => item.id === event.id)

    if (delegation?.phase.attempt !== event.attempt) return unchanged(state)

    if (delegation.phase.type !== "running" || !event.channelOpen) return finish(state, delegation, "discarded")

    // Live waits for an output per call; an error lets the delegator tell the user instead of waiting forever.
    const resumed = resume(
      state,
      delegation,
      delegation.sessionID,
      delegation.phase.pending.map((id) => ({ call_id: id, output: TIMED_OUT })),
    )

    return { state: resumed.state, effects: [{ type: "abort", id: delegation.id }, ...resumed.effects] }
  }

  if (event.type === "round.completed") {
    const delegation = state.delegations.find((item) => item.id === event.id)

    if (delegation?.phase.type !== "running" || delegation.phase.attempt !== event.attempt) return unchanged(state)

    return resume(state, delegation, event.sessionID, event.outputs)
  }

  return responded(state, event)
}

function resume(
  state: VoiceDelegationState,
  delegation: Delegation,
  sessionID: string,
  outputs: readonly ToolOutput[],
): VoiceDelegationTransition {
  const attempt = state.seq + 1

  return {
    state: replace(
      { ...state, seq: attempt },
      { ...delegation, sessionID, phase: { type: "responding", attempt, calls: [] } },
    ),
    effects: [
      { type: "outputs", outputs },
      { type: "deadline", id: delegation.id, attempt, ms: RESPONSE_TIMEOUT },
    ],
  }
}

function responded(
  state: VoiceDelegationState,
  event: Extract<VoiceDelegationEvent, { type: "response.created" | "response.call" | "response.finished" }>,
): VoiceDelegationTransition {
  const delegation = owner(state, event)

  if (!delegation) return unchanged(state)
  const phase = { ...delegation.phase, responseID: delegation.phase.responseID ?? event.responseID }

  if (event.type === "response.created") return { state: replace(state, { ...delegation, phase }), effects: [] }

  if (event.type === "response.call") {
    if (state.delegations.some((item) => item.callIDs.includes(event.call.call_id))) return unchanged(state)

    return {
      state: replace(state, {
        ...delegation,
        callIDs: [...delegation.callIDs, event.call.call_id],
        phase: { ...phase, calls: [...phase.calls, event.call] },
      }),
      effects: [],
    }
  }

  const key = event.responseID ?? delegation.phase.responseID

  if (!key || state.finished.includes(key)) return unchanged(state)
  const next = { ...state, finished: [...state.finished, key] }

  // A cancelled, failed or runaway response ends only its own delegation; the call goes on.
  if (event.outcome !== "completed" || (phase.calls.length > 0 && delegation.rounds >= MAX_ROUNDS))
    return finish(next, delegation, "discarded")

  if (!phase.calls.length) return finish(next, delegation, "answered")
  const attempt = state.seq + 1

  return {
    state: replace(
      { ...next, seq: attempt },
      {
        ...delegation,
        rounds: delegation.rounds + 1,
        phase: { type: "running", attempt, pending: phase.calls.map((call) => call.call_id) },
      },
    ),
    effects: [
      { type: "deadline", id: delegation.id, attempt, ms: phase.calls.length * TOOL_TIMEOUT },
      {
        type: "round",
        id: delegation.id,
        attempt,
        request: { id: delegation.id, sessionID: delegation.sessionID, transcript: delegation.transcript },
        calls: phase.calls,
      },
    ],
  }
}

// Without a delegation ID, a response belongs to the delegation already bound to it, else to the oldest one still
// waiting for a response. Delegations running tools have not asked for one yet.
function owner(state: VoiceDelegationState, event: Routed) {
  if (event.delegationID) return state.delegations.filter(responding).find((item) => item.id === event.delegationID)

  if (event.responseID && state.finished.includes(event.responseID)) return undefined
  const waiting = state.delegations.filter(responding)

  if (!event.responseID) return waiting[0]

  return (
    waiting.find((item) => item.phase.responseID === event.responseID) ?? waiting.find((item) => !item.phase.responseID)
  )
}

function responding(
  delegation: Delegation,
): delegation is Delegation & { phase: Extract<DelegationPhase, { type: "responding" }> } {
  return delegation.phase.type === "responding"
}

function replace(state: VoiceDelegationState, delegation: Delegation): VoiceDelegationState {
  return { ...state, delegations: state.delegations.map((item) => (item.id === delegation.id ? delegation : item)) }
}

function finish(
  state: VoiceDelegationState,
  delegation: Delegation,
  outcome: "answered" | "discarded",
): VoiceDelegationTransition {
  return {
    state: { ...state, delegations: state.delegations.filter((item) => item.id !== delegation.id) },
    effects: [{ type: "finish", id: delegation.id, outcome }],
  }
}

function unchanged(state: VoiceDelegationState): VoiceDelegationTransition {
  return { state, effects: [] }
}
