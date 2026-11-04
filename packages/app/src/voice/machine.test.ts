import { expect, test } from "bun:test"
import { decodeEvent } from "./protocol"
import {
  createVoiceDelegationState,
  delegating,
  MAX_ROUNDS,
  responseEvent,
  RESPONSE_TIMEOUT,
  TIMED_OUT,
  transitionVoiceDelegation,
  type ResponseOutcome,
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

// Response events go through the real decoder, so they carry only the fields Live sends.
function live(delegationID: string | null, nested: object) {
  const event = decodeEvent(JSON.stringify({ type: "response.event", delegation_id: delegationID, event: nested }))
  const next = event && responseEvent(event)

  if (!next) throw new Error("not a delegation event")

  return next
}

const opened = (id: string): VoiceDelegationEvent => ({
  type: "delegation.created",
  id,
  sessionID: "ses_here",
  transcript: [`user: ${id}`],
})

const started = (responseID: string, delegationID: string | null = null) =>
  live(delegationID, { type: "response.created", response: { id: responseID } })

// Function call items name their response only through `response_id`, when Live sends it.
const called = (callID: string, responseID?: string, delegationID: string | null = null) =>
  live(delegationID, {
    type: "response.output_item.done",
    response_id: responseID,
    item: { type: "function_call", call_id: callID, name: "send_message", arguments: "{}" },
  })

const ended = (responseID: string, outcome: ResponseOutcome, delegationID: string | null = null) =>
  live(delegationID, { type: `response.${outcome}`, response: { id: responseID } })

const attempt = (state: VoiceDelegationState, id: string) =>
  state.delegations.find((delegation) => delegation.id === id)?.phase.attempt ?? -1

const ran = (state: VoiceDelegationState, id: string, callID: string, output = "{}"): VoiceDelegationEvent => ({
  type: "tool.completed",
  id,
  attempt: attempt(state, id),
  sessionID: "ses_here",
  output: { call_id: callID, output },
})

const timeout = (state: VoiceDelegationState, id: string, channelOpen: boolean): VoiceDelegationEvent => ({
  type: "delegation.timeout",
  id,
  attempt: attempt(state, id),
  channelOpen,
})

const finishes = (effects: VoiceDelegationEffect[]) => effects.filter((effect) => effect.type === "finish")

const rounds = (effects: VoiceDelegationEffect[]) =>
  effects
    .filter((effect) => effect.type === "round")
    .map((effect) => [effect.id, effect.calls.map((call) => call.call_id)])

test("an untagged response reaches the open delegation while another runs tools", () => {
  // del_1 runs send_message when del_2 starts; Live then omits delegation_id on del_2's events.
  const running = replay([
    opened("del_1"),
    started("resp_1", "del_1"),
    called("call_1", "resp_1", "del_1"),
    ended("resp_1", "completed", "del_1"),
    opened("del_2"),
  ])

  expect(rounds(running.effects)).toEqual([["del_1", ["call_1"]]])

  const second = replay([started("resp_2"), ended("resp_2", "completed")], running.state)

  expect(finishes(second.effects)).toEqual([{ type: "finish", id: "del_2", outcome: "answered" }])

  const first = replay(
    [ran(second.state, "del_1", "call_1"), started("resp_3"), ended("resp_3", "completed")],
    second.state,
  )

  expect(first.effects).toContainEqual({ type: "outputs", outputs: [{ call_id: "call_1", output: "{}" }] })
  expect(finishes(first.effects)).toEqual([{ type: "finish", id: "del_1", outcome: "answered" }])
  // Session replies wait on this; before, del_2 never finished and replies were never announced.
  expect(delegating(first.state)).toBe(false)
})

test("an untagged function call follows its response ID to its own delegation", () => {
  const result = replay([
    opened("del_1"),
    opened("del_2"),
    started("resp_1"),
    started("resp_2"),
    called("call_2", "resp_2"),
    ended("resp_2", "completed"),
  ])

  // Attached to del_1, the call would leave del_2 answered while Live waits for call_2's output.
  expect(rounds(result.effects)).toEqual([["del_2", ["call_2"]]])
  expect(finishes(result.effects)).toEqual([])
})

test.each(["cancelled", "failed", "incomplete"] as const)("response.%s ends only its own delegation", (outcome) => {
  const result = replay([
    opened("del_1"),
    started("resp_1"),
    opened("del_2"),
    ended("resp_1", outcome),
    started("resp_2"),
    ended("resp_2", "completed"),
  ])

  expect(finishes(result.effects)).toEqual([
    { type: "finish", id: "del_1", outcome: "discarded" },
    { type: "finish", id: "del_2", outcome: "answered" },
  ])
  expect(delegating(result.state)).toBe(false)
})

test("a timeout with the data channel closed discards only its delegation and ignores earlier attempts", () => {
  const start = replay([opened("del_1"), opened("del_2")])

  expect(start.effects).toContainEqual({
    type: "deadline",
    id: "del_1",
    attempt: attempt(start.state, "del_1"),
    ms: RESPONSE_TIMEOUT,
  })

  const running = replay(
    [called("call_1"), ended("resp_1", "completed", "del_1"), timeout(start.state, "del_1", true)],
    start.state,
  )

  expect(finishes(running.effects)).toEqual([])

  const timedOut = replay(
    [timeout(running.state, "del_1", false), ran(running.state, "del_1", "call_1")],
    running.state,
  )

  expect(timedOut.effects).toEqual([{ type: "finish", id: "del_1", outcome: "discarded" }])
  expect(timedOut.state.delegations.map((delegation) => delegation.id)).toEqual(["del_2"])

  // A response that never finishes has no outputs to send, so it ends even with the channel open.
  const silent = replay([timeout(timedOut.state, "del_2", true)], timedOut.state)

  expect(silent.effects).toEqual([{ type: "finish", id: "del_2", outcome: "discarded" }])
})

test("a delegation that ends early leaves its response unable to finish a newer one", () => {
  const bound = replay([opened("del_1"), started("resp_1")])
  const late = [called("call_1", "resp_1"), ended("resp_1", "completed")]
  const timedOut = replay([timeout(bound.state, "del_1", true), opened("del_2")], bound.state)
  const reset = replay([{ type: "call.reset" }, opened("del_2")], bound.state)

  expect(replay(late, timedOut.state)).toEqual({ state: timedOut.state, effects: [] })
  expect(replay(late, reset.state)).toEqual({ state: reset.state, effects: [] })
})

test("a tool round that times out keeps finished outputs and reports only unfinished calls", () => {
  const running = replay([opened("del_1"), called("call_1"), called("call_2"), ended("resp_1", "completed", "del_1")])
  const admitted = JSON.stringify({ admitted: true })
  const progressed = replay([ran(running.state, "del_1", "call_1", admitted)], running.state)

  expect(progressed.effects).toEqual([])

  const timedOut = transitionVoiceDelegation(progressed.state, timeout(progressed.state, "del_1", true))

  expect(timedOut.effects).toEqual([
    { type: "abort", id: "del_1" },
    {
      type: "outputs",
      outputs: [
        { call_id: "call_1", output: admitted },
        { call_id: "call_2", output: TIMED_OUT },
      ],
    },
    { type: "deadline", id: "del_1", attempt: attempt(timedOut.state, "del_1"), ms: RESPONSE_TIMEOUT },
  ])

  const answered = replay(
    [ran(progressed.state, "del_1", "call_2"), started("resp_2"), ended("resp_2", "completed")],
    timedOut.state,
  )

  expect(answered.effects).toEqual([{ type: "finish", id: "del_1", outcome: "answered" }])
})

test("a runaway delegation is discarded after the last allowed round", () => {
  const result = Array.from({ length: MAX_ROUNDS + 1 }, (_, index) => index).reduce(
    (current, index) => {
      const finished = replay([called(`call_${index}`), ended(`resp_${index}`, "completed", "del_1")], current.state)

      const done = finished.state.delegations.length
        ? replay([ran(finished.state, "del_1", `call_${index}`)], finished.state)
        : { state: finished.state, effects: [] }

      return { state: done.state, effects: [...current.effects, ...finished.effects, ...done.effects] }
    },
    replay([opened("del_1")]),
  )

  expect(rounds(result.effects)).toHaveLength(MAX_ROUNDS)
  expect(finishes(result.effects)).toEqual([{ type: "finish", id: "del_1", outcome: "discarded" }])
})

test("replayed function calls and terminal events are ignored", () => {
  const start = replay([opened("del_1"), opened("del_2")])

  const result = replay(
    [
      started("resp_1", "del_1"),
      called("call_1", undefined, "del_1"),
      ended("resp_1", "completed", "del_1"),
      // Untagged repeats would otherwise run call_1 again or finish del_2 with del_1's response.
      called("call_1", "resp_2"),
      ended("resp_1", "completed"),
    ],
    start.state,
  )

  expect(rounds(result.effects)).toHaveLength(1)
  expect(finishes(result.effects)).toEqual([])
  expect(result.state.delegations[1]).toEqual(start.state.delegations[1])
})

test("a dropped call discards every open delegation", () => {
  const result = replay([opened("del_1"), opened("del_2"), { type: "call.reset" }])

  expect(finishes(result.effects)).toEqual([
    { type: "finish", id: "del_1", outcome: "discarded" },
    { type: "finish", id: "del_2", outcome: "discarded" },
  ])
  expect(delegating(result.state)).toBe(false)
})
