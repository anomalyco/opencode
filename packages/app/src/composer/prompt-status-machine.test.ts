import { describe, expect, test } from "bun:test"
import {
  SERVER_PROMPT_STATUS,
  transitionPromptStatus,
  type PromptStatusEvent,
  type PromptStatusState,
  type PromptStatusTransition,
} from "./prompt-status-machine"

function replay(events: PromptStatusEvent[], state: PromptStatusState = SERVER_PROMPT_STATUS) {
  const initial: PromptStatusTransition = { state, effects: [] }

  return events.reduce((result, event) => {
    const next = transitionPromptStatus(result.state, event)

    return { state: next.state, effects: [...result.effects, ...next.effects] }
  }, initial)
}

describe("transitionPromptStatus", () => {
  test("a prompt that fails after a newer one went out leaves the newer prompt's turn running", () => {
    const result = replay([
      { type: "dispatched", id: "msg_first", working: false },
      // The first prompt's optimistic status shows the Session as running when the second goes out.
      { type: "dispatched", id: "msg_second", working: true },
      { type: "failed", id: "msg_first" },
    ])

    expect(result.state).toEqual({ type: "optimistic", latest: "msg_second" })
    expect(result.effects).toEqual([{ type: "status.set", status: "running" }])

    // The newest prompt owns the optimistic status, so its own failure still puts the Session back to idle.
    expect(transitionPromptStatus(result.state, { type: "failed", id: "msg_second" })).toEqual({
      state: SERVER_PROMPT_STATUS,
      effects: [{ type: "status.set", status: "idle" }],
    })
  })

  test("a prompt to an idle Session shows it running until the prompt fails", () => {
    expect(
      replay([
        { type: "dispatched", id: "msg_first", working: false },
        { type: "failed", id: "msg_first" },
      ]),
    ).toEqual({
      state: SERVER_PROMPT_STATUS,
      effects: [
        { type: "status.set", status: "running" },
        { type: "status.set", status: "idle" },
      ],
    })
  })

  test("once any prompt is admitted, a failure leaves the status to the server", () => {
    const admitted = replay([
      { type: "dispatched", id: "msg_first", working: false },
      { type: "dispatched", id: "msg_second", working: true },
      { type: "admitted" },
    ])

    expect(admitted.state).toBe(SERVER_PROMPT_STATUS)
    expect(transitionPromptStatus(admitted.state, { type: "failed", id: "msg_second" })).toEqual({
      state: admitted.state,
      effects: [],
    })
  })

  test("a prompt to a Session the server already reports running never touches its status", () => {
    const result = replay([
      { type: "dispatched", id: "msg_first", working: true },
      { type: "failed", id: "msg_first" },
    ])

    expect(result).toEqual({ state: SERVER_PROMPT_STATUS, effects: [] })
  })
})
