import { describe, expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageInfo, SessionStatus } from "@opencode/client/promise"
import { timelinePresets, type TimelineDetail } from "./detail"
import { Timeline } from "./projection"
import {
  IDLE_TURN_PHASE,
  INTERRUPTED_TURN_PHASE,
  transitionTurnPhase,
  viewTurnPhase,
  WORKING_TURN_PHASE,
  type TurnPhaseEvent,
} from "./turn-phase-machine"

const user = { id: "msg_user", type: "user", text: "go", time: { created: 1 } } satisfies SessionMessageInfo

const thought = { type: "reasoning", text: "Thinking", time: { created: 2 } } as const

const grouped: TimelineDetail = timelinePresets[2].value

function assistant(id: string, fields: Partial<SessionMessageAssistant> = {}): SessionMessageAssistant {
  return {
    id,
    type: "assistant",
    agent: "build",
    model: { id: "model", providerID: "provider" },
    content: [thought],
    time: { created: 2 },
    ...fields,
  }
}

function phase(
  messages: SessionMessageInfo[],
  status: SessionStatus = { type: "busy" },
  detail: TimelineDetail | undefined = grouped,
) {
  return Timeline.constructSessionMessageRows(
    messages,
    true,
    status,
    undefined,
    false,
    false,
    undefined,
    detail,
  ).turnPhaseByID.get(user.id)!
}

describe("turn phase", () => {
  test("ends the live phase when a step retries or fails while the Session is still busy", () => {
    const retrying = phase([
      user,
      assistant("msg_a", { retry: { attempt: 2, at: 10, error: { type: "ProviderError", message: "rate limited" } } }),
    ])

    const failed = phase([user, assistant("msg_a", { error: { type: "provider.error", message: "Failed" } })])

    expect(retrying).toEqual({ status: "retrying", attempt: 2, message: "rate limited", next: 10 })
    expect(viewTurnPhase(retrying)).toMatchObject({ live: false, hideCopy: true, streamingReasoningRef: undefined })
    expect(failed).toEqual({ status: "failed", error: { text: "Failed" } })
    expect(viewTurnPhase(failed)).toMatchObject({ live: false, hideCopy: false, streamingReasoningRef: undefined })
  })

  test("stays working between steps and settles on an interrupt or a failed idle marker before the status does", () => {
    const between = phase([user, assistant("msg_a", { content: [], time: { created: 2, completed: 3 } })])

    const interrupted = phase([
      user,
      assistant("msg_a", { error: { type: "MessageAbortedError", message: "Stopped" } }),
    ])

    const idle = phase([
      user,
      assistant("msg_a"),
      {
        id: "msg_idle",
        type: "idle",
        outcome: "failed",
        error: { type: "unknown", message: "Session failed" },
        time: { created: 4 },
      },
    ])

    expect(between).toBe(WORKING_TURN_PHASE)
    expect(viewTurnPhase(between).live).toBe(true)
    expect(interrupted).toBe(INTERRUPTED_TURN_PHASE)
    expect(viewTurnPhase(interrupted)).toMatchObject({ live: false, hideCopy: false, settled: true })
    expect(idle).toEqual({ status: "failed", error: { text: "Session failed" } })
    expect(viewTurnPhase(idle).streamingReasoningRef).toBeUndefined()
  })

  test("streams reasoning only where the reader sees it", () => {
    const ref = { messageID: "msg_a", partID: "msg_a:reasoning:0" }
    const messages = [user, assistant("msg_a")]

    const hidden = phase(
      messages,
      { type: "busy" },
      { ...grouped, thinking: { ...grouped.thinking, placement: "hidden" } },
    )

    const separate = phase(
      messages,
      { type: "busy" },
      { ...grouped, thinking: { ...grouped.thinking, placement: "separate" } },
    )

    const inline = phase(
      messages,
      { type: "busy" },
      { ...grouped, thinking: { ...grouped.thinking, placement: "grouped" } },
    )

    expect(hidden).toBe(WORKING_TURN_PHASE)
    expect(viewTurnPhase(separate)).toMatchObject({ separateThinkingRef: ref, streamingReasoningRef: ref })
    expect(viewTurnPhase(inline)).toMatchObject({ separateThinkingRef: undefined, streamingReasoningRef: ref })
  })

  test("settles every turn but the active one, and the active one once the Session is idle", () => {
    const messages = [user, assistant("msg_a")]

    const projection = Timeline.constructSessionMessageRows(
      [...messages, { id: "msg_next", type: "user", text: "next", time: { created: 5 } }],
      true,
      { type: "busy" },
    )

    expect(projection.turnPhaseByID.get(user.id)).toBe(IDLE_TURN_PHASE)
    expect(projection.turnPhaseByID.get("msg_next")).toBe(WORKING_TURN_PHASE)
    expect(phase(messages, { type: "idle" })).toBe(IDLE_TURN_PHASE)
  })

  test("recovers from a failed step when a later step runs", () => {
    const failed = {
      type: "step",
      active: true,
      session: "busy",
      completed: true,
      error: { interrupted: false, info: { text: "x" } },
    } satisfies TurnPhaseEvent

    const next = { type: "step", active: true, session: "busy", completed: false } satisfies TurnPhaseEvent

    const state = [failed, next].reduce(
      transitionTurnPhase,
      transitionTurnPhase(IDLE_TURN_PHASE, { type: "started", live: true }),
    )

    expect(state).toBe(WORKING_TURN_PHASE)
  })

  test("keeps the same thinking phase while the same part streams", () => {
    const event = {
      type: "step",
      active: true,
      session: "busy",
      completed: false,
      reasoning: { ref: { messageID: "msg_a", partID: "p" }, placement: "grouped" },
    } satisfies TurnPhaseEvent

    const first = transitionTurnPhase(WORKING_TURN_PHASE, event)

    expect(
      transitionTurnPhase(first, {
        ...event,
        reasoning: { ...event.reasoning, ref: { messageID: "msg_a", partID: "p" } },
      }),
    ).toBe(first)
  })
})
