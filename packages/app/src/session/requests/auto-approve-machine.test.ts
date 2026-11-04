import { describe, expect, test } from "bun:test"
import {
  INITIAL_AUTO_APPROVE_STATE,
  isDockVisible,
  transitionAutoApprove,
  type AutoApproveEffect,
  type AutoApproveEvent,
  type AutoApproveState,
  type AutoApproveTransition,
} from "./auto-approve-machine"

const approve = (runId: string): AutoApproveEvent => ({
  type: "approve",
  sessionID: "ses_1",
  projectID: "proj_1",
  runId,
})

const replying = (runId: string, attempt: number): AutoApproveState => ({
  status: "replying",
  sessionID: "ses_1",
  projectID: "proj_1",
  runId,
  attempt,
})

const waiting = (runId: string, attempt: number): AutoApproveState => ({
  status: "waiting-retry",
  sessionID: "ses_1",
  projectID: "proj_1",
  runId,
  attempt,
})

const gaveUp: AutoApproveState = { status: "gave-up", projectID: "proj_1" }

function replay(events: AutoApproveEvent[], from = INITIAL_AUTO_APPROVE_STATE) {
  return events.reduce<AutoApproveTransition[]>((steps, event) => {
    steps.push(transitionAutoApprove(steps.at(-1)?.state ?? from, event))

    return steps
  }, [])
}

describe("transitionAutoApprove", () => {
  test("approves once and settles on a successful reply", () => {
    const steps = replay([approve("r1"), { type: "reply.succeeded", runId: "r1", attempt: 0 }])

    expect(steps.map((step) => step.state)).toEqual([replying("r1", 0), { status: "replied" }])
    expect(steps.map((step) => step.effects)).toEqual([
      [{ type: "reply", sessionID: "ses_1", runId: "r1", attempt: 0 }],
      [],
    ])
  })

  test("surfaces the request in the dock once every retry fails", () => {
    const steps = replay([
      approve("r1"),
      { type: "reply.failed", runId: "r1", attempt: 0 },
      { type: "retry.due", runId: "r1", attempt: 1 },
      { type: "reply.failed", runId: "r1", attempt: 1 },
      { type: "retry.due", runId: "r1", attempt: 2 },
      { type: "reply.failed", runId: "r1", attempt: 2 },
    ])

    expect(steps.map((step) => step.state)).toEqual([
      replying("r1", 0),
      waiting("r1", 1),
      replying("r1", 1),
      waiting("r1", 2),
      replying("r1", 2),
      gaveUp,
    ])
    expect(steps.map((step) => step.effects)).toEqual([
      [{ type: "reply", sessionID: "ses_1", runId: "r1", attempt: 0 }],
      [{ type: "schedule-retry", runId: "r1", attempt: 1, delayMs: 1000 }],
      [{ type: "reply", sessionID: "ses_1", runId: "r1", attempt: 1 }],
      [{ type: "schedule-retry", runId: "r1", attempt: 2, delayMs: 2000 }],
      [{ type: "reply", sessionID: "ses_1", runId: "r1", attempt: 2 }],
      [],
    ])
    expect(steps.map((step) => isDockVisible(step.state, true))).toEqual([false, false, false, false, false, true])
  })

  test("recovers on a later attempt", () => {
    const state = replay([
      approve("r1"),
      { type: "reply.failed", runId: "r1", attempt: 0 },
      { type: "retry.due", runId: "r1", attempt: 1 },
      { type: "reply.succeeded", runId: "r1", attempt: 1 },
    ]).at(-1)?.state

    expect(state).toEqual({ status: "replied" })
  })

  test.each<{ name: string; from: AutoApproveState }>([
    { name: "replying", from: replying("r1", 0) },
    { name: "waiting for a retry", from: waiting("r1", 1) },
    { name: "exhausted", from: gaveUp },
    { name: "replied", from: { status: "replied" } },
  ])("ignores another approval while $name", (input) => {
    const result = transitionAutoApprove(input.from, approve("r2"))

    expect(result.state).toBe(input.from)
    expect(result.effects).toEqual([])
  })

  test("rejects results and timers from a superseded cycle or attempt", () => {
    const state = replay([approve("r1"), { type: "cancel" }, approve("r2")]).at(-1)?.state ?? INITIAL_AUTO_APPROVE_STATE

    expect(state).toEqual(replying("r2", 0))

    const stale: AutoApproveEvent[] = [
      { type: "reply.failed", runId: "r1", attempt: 0 },
      { type: "reply.succeeded", runId: "r1", attempt: 0 },
      { type: "reply.failed", runId: "r2", attempt: 1 },
      { type: "retry.due", runId: "r2", attempt: 0 },
    ]

    stale.forEach((event) => {
      const result = transitionAutoApprove(state, event)

      expect(result.state).toBe(state)
      expect(result.effects).toEqual([])
    })

    const pausing = waiting("r2", 1)

    expect(transitionAutoApprove(pausing, { type: "retry.due", runId: "r1", attempt: 1 }).state).toBe(pausing)
  })

  test.each<{ from: AutoApproveState; cancel: AutoApproveState; resolved: AutoApproveState; clears: boolean }>([
    {
      from: INITIAL_AUTO_APPROVE_STATE,
      cancel: INITIAL_AUTO_APPROVE_STATE,
      resolved: INITIAL_AUTO_APPROVE_STATE,
      clears: false,
    },
    { from: replying("r1", 0), cancel: INITIAL_AUTO_APPROVE_STATE, resolved: { status: "replied" }, clears: false },
    { from: waiting("r1", 1), cancel: INITIAL_AUTO_APPROVE_STATE, resolved: { status: "replied" }, clears: true },
    { from: gaveUp, cancel: INITIAL_AUTO_APPROVE_STATE, resolved: { status: "replied" }, clears: false },
    { from: { status: "replied" }, cancel: { status: "replied" }, resolved: { status: "replied" }, clears: false },
  ])("cancel and resolved from $from.status", (input) => {
    const effects: AutoApproveEffect[] = input.clears ? [{ type: "cancel-retry" }] : []

    expect(transitionAutoApprove(input.from, { type: "cancel" })).toEqual({ state: input.cancel, effects })
    expect(transitionAutoApprove(input.from, { type: "resolved" })).toEqual({ state: input.resolved, effects })
  })
})

test.each<{ state: AutoApproveState; on: boolean; off: boolean }>([
  { state: INITIAL_AUTO_APPROVE_STATE, on: false, off: true },
  { state: replying("r1", 0), on: false, off: true },
  { state: waiting("r1", 1), on: false, off: true },
  { state: gaveUp, on: true, off: true },
  { state: { status: "replied" }, on: false, off: false },
])("isDockVisible for $state.status", (input) => {
  expect(isDockVisible(input.state, true)).toBe(input.on)
  expect(isDockVisible(input.state, false)).toBe(input.off)
})
