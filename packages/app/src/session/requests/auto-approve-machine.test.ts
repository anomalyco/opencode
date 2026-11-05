import { describe, expect, test } from "bun:test"
import {
  AUTO_APPROVE_REPLY_TIMEOUT_MS,
  AUTO_APPROVE_SWEEP_TIMEOUT_MS,
  INITIAL_AUTO_APPROVE_STATE,
  INITIAL_AUTO_APPROVE_SWEEP_STATE,
  needsUser,
  transitionAutoApprove,
  transitionAutoApproveSweep,
  type AutoApproveEffect,
  type AutoApproveEvent,
  type AutoApproveState,
  type AutoApproveSweepEffect,
  type AutoApproveSweepEvent,
  type AutoApproveSweepState,
  type AutoApproveSweepTransition,
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

const reply = (runId: string, attempt: number): AutoApproveEffect => ({
  type: "reply",
  sessionID: "ses_1",
  runId,
  attempt,
  timeoutMs: AUTO_APPROVE_REPLY_TIMEOUT_MS,
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
    expect(steps.map((step) => step.effects)).toEqual([[reply("r1", 0)], [{ type: "abort-reply" }]])
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
      [reply("r1", 0)],
      [{ type: "abort-reply" }, { type: "schedule-retry", runId: "r1", attempt: 1, delayMs: 1000 }],
      [reply("r1", 1)],
      [{ type: "abort-reply" }, { type: "schedule-retry", runId: "r1", attempt: 2, delayMs: 2000 }],
      [reply("r1", 2)],
      [{ type: "abort-reply" }],
    ])
    expect(steps.map((step) => needsUser(step.state, true))).toEqual([false, false, false, false, false, true])
  })

  // A reply that never answered used to keep its request hidden from the dock for good.
  test("a reply that never answers times out through the retries and surfaces the request", () => {
    const steps = replay([
      approve("r1"),
      { type: "reply.timed-out", runId: "r1", attempt: 0 },
      // The aborted first reply settles late.
      { type: "reply.failed", runId: "r1", attempt: 0 },
      { type: "retry.due", runId: "r1", attempt: 1 },
      { type: "reply.timed-out", runId: "r1", attempt: 1 },
      { type: "retry.due", runId: "r1", attempt: 2 },
      { type: "reply.timed-out", runId: "r1", attempt: 2 },
    ])

    expect(steps.map((step) => step.state)).toEqual([
      replying("r1", 0),
      waiting("r1", 1),
      waiting("r1", 1),
      replying("r1", 1),
      waiting("r1", 2),
      replying("r1", 2),
      gaveUp,
    ])
    expect(steps[2]?.state).toBe(steps[1]?.state)
    expect(steps.map((step) => step.effects)).toEqual([
      [reply("r1", 0)],
      [{ type: "abort-reply" }, { type: "schedule-retry", runId: "r1", attempt: 1, delayMs: 1000 }],
      [],
      [reply("r1", 1)],
      [{ type: "abort-reply" }, { type: "schedule-retry", runId: "r1", attempt: 2, delayMs: 2000 }],
      [reply("r1", 2)],
      [{ type: "abort-reply" }],
    ])
    expect(needsUser(steps.at(-2)!.state, true)).toBe(false)
    expect(needsUser(steps.at(-1)!.state, true)).toBe(true)
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
      { type: "reply.timed-out", runId: "r1", attempt: 0 },
      { type: "reply.failed", runId: "r2", attempt: 1 },
      { type: "reply.timed-out", runId: "r2", attempt: 1 },
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

  // Turning auto-approve off mid-reply used to leave its "once" reply running while the dock offered Deny.
  test.each<{
    from: AutoApproveState
    cancel: AutoApproveState
    resolved: AutoApproveState
    effects: AutoApproveEffect[]
  }>([
    {
      from: INITIAL_AUTO_APPROVE_STATE,
      cancel: INITIAL_AUTO_APPROVE_STATE,
      resolved: INITIAL_AUTO_APPROVE_STATE,
      effects: [],
    },
    {
      from: replying("r1", 0),
      cancel: INITIAL_AUTO_APPROVE_STATE,
      resolved: { status: "replied" },
      effects: [{ type: "abort-reply" }],
    },
    {
      from: waiting("r1", 1),
      cancel: INITIAL_AUTO_APPROVE_STATE,
      resolved: { status: "replied" },
      effects: [{ type: "cancel-retry" }],
    },
    { from: gaveUp, cancel: INITIAL_AUTO_APPROVE_STATE, resolved: { status: "replied" }, effects: [] },
    { from: { status: "replied" }, cancel: { status: "replied" }, resolved: { status: "replied" }, effects: [] },
  ])("cancel and resolved from $from.status", (input) => {
    expect(transitionAutoApprove(input.from, { type: "cancel" })).toEqual({
      state: input.cancel,
      effects: input.effects,
    })
    expect(transitionAutoApprove(input.from, { type: "resolved" })).toEqual({
      state: input.resolved,
      effects: input.effects,
    })
  })
})

test.each<{ state: AutoApproveState; on: boolean; off: boolean }>([
  { state: INITIAL_AUTO_APPROVE_STATE, on: false, off: true },
  { state: replying("r1", 0), on: false, off: true },
  { state: waiting("r1", 1), on: false, off: true },
  { state: gaveUp, on: true, off: true },
  { state: { status: "replied" }, on: false, off: false },
])("needsUser for $state.status", (input) => {
  expect(needsUser(input.state, true)).toBe(input.on)
  expect(needsUser(input.state, false)).toBe(input.off)
})

describe("transitionAutoApproveSweep", () => {
  const run = (runId: string, attempt: number) => ({
    type: "sweep.run" as const,
    runId,
    attempt,
    timeoutMs: AUTO_APPROVE_SWEEP_TIMEOUT_MS,
  })

  function sweepReplay(
    events: AutoApproveSweepEvent[],
    from: AutoApproveSweepState = INITIAL_AUTO_APPROVE_SWEEP_STATE,
  ) {
    return events.reduce<AutoApproveSweepTransition[]>((steps, event) => {
      steps.push(transitionAutoApproveSweep(steps.at(-1)?.state ?? from, event))

      return steps
    }, [])
  }

  // A sweep stalled on one request used to hold its retries back for good.
  test("a sweep that never finishes times out, retries and comes to rest", () => {
    const steps = sweepReplay([
      { type: "sweep.start", runId: "s1" },
      { type: "sweep.timed-out", runId: "s1", attempt: 0 },
      // The aborted sweep settles late.
      { type: "sweep.failed", runId: "s1", attempt: 0 },
      { type: "sweep.retry-due", runId: "s1", attempt: 1 },
      { type: "sweep.failed", runId: "s1", attempt: 1 },
      { type: "sweep.retry-due", runId: "s1", attempt: 2 },
      { type: "sweep.timed-out", runId: "s1", attempt: 2 },
    ])

    expect(steps.map((step) => step.state)).toEqual([
      { status: "sweeping", runId: "s1", attempt: 0 },
      { status: "waiting-retry", runId: "s1", attempt: 1 },
      { status: "waiting-retry", runId: "s1", attempt: 1 },
      { status: "sweeping", runId: "s1", attempt: 1 },
      { status: "waiting-retry", runId: "s1", attempt: 2 },
      { status: "sweeping", runId: "s1", attempt: 2 },
      INITIAL_AUTO_APPROVE_SWEEP_STATE,
    ])
    expect(steps[2]?.state).toBe(steps[1]?.state)
    expect(steps.map((step) => step.effects)).toEqual([
      [run("s1", 0)],
      [{ type: "sweep.abort" }, { type: "sweep.schedule-retry", runId: "s1", attempt: 1, delayMs: 1000 }],
      [],
      [run("s1", 1)],
      [{ type: "sweep.abort" }, { type: "sweep.schedule-retry", runId: "s1", attempt: 2, delayMs: 2000 }],
      [run("s1", 2)],
      [{ type: "sweep.abort" }],
    ])
  })

  test("a complete sweep comes to rest", () => {
    const steps = sweepReplay([
      { type: "sweep.start", runId: "s1" },
      { type: "sweep.succeeded", runId: "s1", attempt: 0 },
    ])

    expect(steps.at(-1)).toEqual({ state: INITIAL_AUTO_APPROVE_SWEEP_STATE, effects: [{ type: "sweep.abort" }] })
  })

  test("a newer start replaces the sweep or its retry, and the old sweep's results are ignored", () => {
    const sweeping: AutoApproveSweepState = { status: "sweeping", runId: "s1", attempt: 0 }
    const restarted = transitionAutoApproveSweep(sweeping, { type: "sweep.start", runId: "s2" })

    expect(restarted).toEqual({
      state: { status: "sweeping", runId: "s2", attempt: 0 },
      effects: [{ type: "sweep.abort" }, run("s2", 0)],
    })

    const stale: AutoApproveSweepEvent[] = [
      { type: "sweep.succeeded", runId: "s1", attempt: 0 },
      { type: "sweep.failed", runId: "s1", attempt: 0 },
      { type: "sweep.timed-out", runId: "s1", attempt: 0 },
      { type: "sweep.retry-due", runId: "s2", attempt: 0 },
    ]

    stale.forEach((event) => {
      const result = transitionAutoApproveSweep(restarted.state, event)

      expect(result.state).toBe(restarted.state)
      expect(result.effects).toEqual([])
    })

    expect(
      transitionAutoApproveSweep(
        { status: "waiting-retry", runId: "s1", attempt: 1 },
        { type: "sweep.start", runId: "s2" },
      ),
    ).toEqual({
      state: { status: "sweeping", runId: "s2", attempt: 0 },
      effects: [{ type: "sweep.cancel-retry" }, run("s2", 0)],
    })
  })

  test.each<{ from: AutoApproveSweepState; effects: AutoApproveSweepEffect[] }>([
    { from: { status: "sweeping", runId: "s1", attempt: 0 }, effects: [{ type: "sweep.abort" }] },
    { from: { status: "waiting-retry", runId: "s1", attempt: 1 }, effects: [{ type: "sweep.cancel-retry" }] },
  ])("cancel from $from.status", (input) => {
    expect(transitionAutoApproveSweep(input.from, { type: "sweep.cancel" })).toEqual({
      state: INITIAL_AUTO_APPROVE_SWEEP_STATE,
      effects: input.effects,
    })
  })

  test("cancel while idle changes nothing", () => {
    const result = transitionAutoApproveSweep(INITIAL_AUTO_APPROVE_SWEEP_STATE, { type: "sweep.cancel" })

    expect(result.state).toBe(INITIAL_AUTO_APPROVE_SWEEP_STATE)
    expect(result.effects).toEqual([])
  })
})
