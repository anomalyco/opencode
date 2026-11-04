import { expect, test } from "bun:test"
import {
  createVoiceDelegationState,
  delegating,
  MAX_ROUNDS,
  RESPONSE_TIMEOUT,
  transitionVoiceDelegation,
  type VoiceDelegationEffect,
  type VoiceDelegationEvent,
  type VoiceDelegationState,
} from "./machine"

function replay(events: VoiceDelegationEvent[], start = createVoiceDelegationState()) {
  return events.reduce(
    (result: { state: VoiceDelegationState; effects: VoiceDelegationEffect[] }, event) => {
      const next = transitionVoiceDelegation(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state: start, effects: [] },
  )
}

const created = (id: string): VoiceDelegationEvent => ({
  type: "delegation.created",
  id,
  sessionID: "ses_here",
  transcript: [`user: ${id}`],
})

const call = (id: string): Extract<VoiceDelegationEvent, { type: "response.call" }> => ({
  type: "response.call",
  delegationID: null,
  call: { call_id: id, name: "send_message", arguments: "{}" },
})

const finishes = (effects: VoiceDelegationEffect[]) => effects.filter((effect) => effect.type === "finish")

const attempt = (state: VoiceDelegationState, id: string) =>
  state.delegations.find((delegation) => delegation.id === id)?.phase.attempt ?? -1

test("an untagged response reaches the open delegation while another runs tools", () => {
  // del_1 runs send_message when del_2 starts; Live then omits delegation_id on del_2's events.
  const running = replay([
    created("del_1"),
    { type: "response.created", delegationID: "del_1", responseID: "resp_1" },
    { ...call("call_1"), delegationID: "del_1", responseID: "resp_1" },
    { type: "response.finished", delegationID: "del_1", responseID: "resp_1", outcome: "completed" },
    created("del_2"),
  ])

  expect(running.effects.filter((effect) => effect.type === "round").map((effect) => effect.id)).toEqual(["del_1"])

  const second = replay(
    [
      { type: "response.created", delegationID: null, responseID: "resp_2" },
      { type: "response.finished", delegationID: null, responseID: "resp_2", outcome: "completed" },
    ],
    running.state,
  )

  expect(finishes(second.effects)).toEqual([{ type: "finish", id: "del_2", outcome: "answered" }])

  const first = replay(
    [
      {
        type: "round.completed",
        id: "del_1",
        attempt: attempt(second.state, "del_1"),
        sessionID: "ses_other",
        outputs: [{ call_id: "call_1", output: "{}" }],
      },
      { type: "response.created", delegationID: null, responseID: "resp_3" },
      { type: "response.finished", delegationID: null, responseID: "resp_3", outcome: "completed" },
    ],
    second.state,
  )

  expect(first.effects).toContainEqual({ type: "outputs", outputs: [{ call_id: "call_1", output: "{}" }] })
  expect(finishes(first.effects)).toEqual([{ type: "finish", id: "del_1", outcome: "answered" }])
  // Session replies wait on this; before, del_2 never finished and replies were never announced.
  expect(delegating(first.state)).toBe(false)
})

test.each(["cancelled", "failed", "incomplete"] as const)("response.%s ends only its own delegation", (outcome) => {
  const result = replay([
    created("del_1"),
    { type: "response.created", delegationID: null, responseID: "resp_1" },
    created("del_2"),
    { type: "response.finished", delegationID: null, responseID: "resp_1", outcome },
    { type: "response.created", delegationID: null, responseID: "resp_2" },
    { type: "response.finished", delegationID: null, responseID: "resp_2", outcome: "completed" },
  ])

  expect(finishes(result.effects)).toEqual([
    { type: "finish", id: "del_1", outcome: "discarded" },
    { type: "finish", id: "del_2", outcome: "answered" },
  ])
  expect(delegating(result.state)).toBe(false)
})

test("a timeout discards only its delegation and ignores an earlier phase's timer and round", () => {
  const start = replay([created("del_1"), created("del_2")])
  expect(start.effects).toContainEqual({
    type: "deadline",
    id: "del_1",
    attempt: attempt(start.state, "del_1"),
    ms: RESPONSE_TIMEOUT,
  })

  const responding = attempt(start.state, "del_1")

  const running = replay(
    [
      call("call_1"),
      { type: "response.finished", delegationID: "del_1", responseID: "resp_1", outcome: "completed" },
      { type: "delegation.timeout", id: "del_1", attempt: responding },
    ],
    start.state,
  )

  expect(finishes(running.effects)).toEqual([])

  const round = attempt(running.state, "del_1")

  const timedOut = replay(
    [
      { type: "delegation.timeout", id: "del_1", attempt: round },
      { type: "round.completed", id: "del_1", attempt: round, sessionID: "ses_here", outputs: [] },
    ],
    running.state,
  )

  expect(timedOut.effects).toEqual([{ type: "finish", id: "del_1", outcome: "discarded" }])
  expect(timedOut.state.delegations.map((delegation) => delegation.id)).toEqual(["del_2"])
})

test("a runaway delegation is discarded after the last allowed round", () => {
  const result = Array.from({ length: MAX_ROUNDS + 1 }, (_, index) => index).reduce(
    (current, index) => {
      const finished = replay(
        [
          call(`call_${index}`),
          { type: "response.finished", delegationID: "del_1", responseID: `resp_${index}`, outcome: "completed" },
        ],
        current.state,
      )

      const ran = finished.state.delegations.length
        ? replay(
            [
              {
                type: "round.completed",
                id: "del_1",
                attempt: attempt(finished.state, "del_1"),
                sessionID: "ses_here",
                outputs: [],
              },
            ],
            finished.state,
          )
        : finished

      return {
        state: ran.state,
        effects: [...current.effects, ...finished.effects, ...(ran === finished ? [] : ran.effects)],
      }
    },
    replay([created("del_1")]),
  )

  expect(result.effects.filter((effect) => effect.type === "round")).toHaveLength(MAX_ROUNDS)
  expect(finishes(result.effects)).toEqual([{ type: "finish", id: "del_1", outcome: "discarded" }])
})

test("replayed function calls and terminal events are ignored", () => {
  const start = replay([created("del_1"), created("del_2")])

  const result = replay(
    [
      { type: "response.created", delegationID: "del_1", responseID: "resp_1" },
      { ...call("call_1"), delegationID: "del_1" },
      { type: "response.finished", delegationID: "del_1", responseID: "resp_1", outcome: "completed" },
      // Untagged repeats would otherwise run call_1 again or finish del_2 with del_1's response.
      { ...call("call_1"), responseID: "resp_2" },
      { type: "response.finished", delegationID: null, responseID: "resp_1", outcome: "completed" },
    ],
    start.state,
  )

  expect(result.effects.filter((effect) => effect.type === "round")).toHaveLength(1)
  expect(finishes(result.effects)).toEqual([])
  expect(result.state.delegations[1]).toEqual(start.state.delegations[1])
})

test("a dropped call discards every open delegation", () => {
  const result = replay([created("del_1"), created("del_2"), { type: "call.reset" }])

  expect(finishes(result.effects)).toEqual([
    { type: "finish", id: "del_1", outcome: "discarded" },
    { type: "finish", id: "del_2", outcome: "discarded" },
  ])
  expect(delegating(result.state)).toBe(false)
})
