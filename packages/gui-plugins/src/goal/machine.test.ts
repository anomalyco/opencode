import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Goal } from "@opencode/schema/goal"
import {
  createGoalState,
  selectGoal,
  selectGoalBusy,
  transitionGoal,
  type GoalEffect,
  type GoalEvent,
  type GoalState,
} from "./machine"

const decode = Schema.decodeUnknownSync(Goal.State)

const goal = (status: Goal.Status) =>
  decode({ id: "g1", objective: "ship it", status, rounds: 1, maxRounds: 20, boot: "b1", updatedAt: 1 })

const s1 = { key: "srv\nses_1", serverID: "srv", sessionID: "ses_1", directory: "/repo" }

const s2 = { key: "srv\nses_2", serverID: "srv", sessionID: "ses_2", directory: "/repo" }

// Replays events through the pure machine and collects every effect it asked for, in order.
function play(state: GoalState, ...events: GoalEvent[]) {
  return events.reduce<{ state: GoalState; effects: readonly GoalEffect[] }>(
    (result, event) => {
      const next = transitionGoal(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

// S1 routed with its snapshot loaded: subscription 1, snapshot attempt 2.
function liveS1(value = goal("active")) {
  return play(
    createGoalState(),
    { type: "target.attached", ...s1 },
    { type: "snapshot.loaded", attempt: 2, goal: value },
  ).state
}

describe("goal snapshot and subscription", () => {
  test("a failed refetch after switching back drops the cached goal instead of showing it forever", () => {
    const back = play(liveS1(), { type: "target.attached", ...s2 }, { type: "target.attached", ...s1 })

    // Shown while revalidating, as before.
    expect(selectGoal(back.state, s1.key)).toEqual(goal("active"))
    const fetch = back.effects.findLast((effect) => effect.type === "fetch")

    expect(fetch).toMatchObject({ sessionID: "ses_1" })
    const attempt = fetch?.type === "fetch" ? fetch.attempt : 0

    const failed = play(back.state, { type: "snapshot.failed", attempt })

    expect(selectGoal(failed.state, s1.key)).toBeUndefined()
    expect(failed.effects).toEqual([{ type: "schedule-retry", attempt: attempt + 1, delay: 1_000 }])
  })

  test("retries three times, then settles failed; a change still brings it live", () => {
    const events = [2, 3, 4].flatMap((attempt): GoalEvent[] => [
      { type: "snapshot.failed", attempt },
      { type: "retry.due", attempt: attempt + 1 },
    ])
    const retried = play(createGoalState(), { type: "target.attached", ...s1 }, ...events)

    expect(retried.effects.filter((effect) => effect.type === "fetch")).toHaveLength(4)
    expect(retried.effects.flatMap((effect) => (effect.type === "schedule-retry" ? [effect.delay] : []))).toEqual([
      1_000, 2_000, 4_000,
    ])

    const failed = play(retried.state, { type: "snapshot.failed", attempt: 5 })

    expect(failed.effects).toEqual([])
    expect(failed.state.status === "active" && failed.state.sessions.get(s1.key)).toEqual({ status: "failed" })

    const changed = play(failed.state, { type: "changed", subscription: 1, key: s1.key, goal: goal("paused") })

    expect(selectGoal(changed.state, s1.key)).toEqual(goal("paused"))
  })

  test("a disconnected session hides its cached goal", () => {
    const detached = play(liveS1(), { type: "target.detached" })

    expect(detached.effects).toEqual([{ type: "unsubscribe", subscription: 1 }])
    expect(selectGoal(detached.state, s1.key)).toBeUndefined()
  })

  test("a change that beats the snapshot wins, and the late snapshot is ignored", () => {
    const changed = play(
      createGoalState(),
      { type: "target.attached", ...s1 },
      { type: "changed", subscription: 1, key: s1.key, goal: goal("paused") },
    )

    expect(changed.effects.at(-1)).toEqual({ type: "cancel", attempt: 2 })

    const late = play(changed.state, { type: "snapshot.loaded", attempt: 2, goal: goal("active") })

    expect(late.state).toBe(changed.state)
    expect(selectGoal(late.state, s1.key)).toEqual(goal("paused"))
  })

  test("changes from an old subscription or for unvisited sessions are ignored", () => {
    const state = liveS1()

    expect(play(state, { type: "changed", subscription: 0, key: s1.key, goal: null }).state).toBe(state)
    expect(play(state, { type: "changed", subscription: 1, key: "srv\nses_9", goal: goal("active") }).state).toBe(state)
  })

  test("another session's change updates or drops the goal it showed", () => {
    const away = play(liveS1(), { type: "target.attached", ...s2 }).state
    const cleared = play(away, { type: "changed", subscription: 3, key: s1.key, goal: null })

    expect(cleared.state.status === "active" && cleared.state.sessions.has(s1.key)).toBe(false)
  })
})

describe("goal commands", () => {
  test("a second click while a command is in flight sends nothing", () => {
    const request: GoalEvent = { type: "command.requested", ...s1, action: "pause" }
    const first = play(liveS1(), request)

    expect(first.effects).toEqual([{ type: "command", attempt: 3, ...pick(s1), action: "pause" }])
    expect(selectGoalBusy(first.state, s1.key)).toBe(true)
    expect(play(first.state, request).state).toBe(first.state)

    const done = play(first.state, { type: "command.succeeded", key: s1.key, attempt: 3 })

    expect(selectGoalBusy(done.state, s1.key)).toBe(false)
    expect(done.effects).toEqual([])
  })

  test("a failed or timed-out command frees the buttons and shows an error", () => {
    const first = play(liveS1(), { type: "command.requested", ...s1, action: "clear" }).state

    expect(play(first, { type: "command.failed", key: s1.key, attempt: 3, message: "No goal is set." }).effects).toEqual(
      [{ type: "toast-error", message: "No goal is set." }],
    )

    const timedOut = play(first, { type: "command.failed", key: s1.key, attempt: 3 })

    expect(timedOut.effects).toEqual([{ type: "toast-error", message: undefined }])
    expect(selectGoalBusy(timedOut.state, s1.key)).toBe(false)
    expect(play(first, { type: "command.succeeded", key: s1.key, attempt: 9 }).state).toBe(first)
  })
})

describe("goal lifetime", () => {
  test("closed tabs are forgotten and their commands cancelled", () => {
    const state = play(
      liveS1(),
      { type: "command.requested", ...s1, action: "pause" },
      { type: "target.attached", ...s2 },
    ).state
    const pruned = play(state, { type: "sessions.pruned", keep: new Set([s2.key]) })

    expect(pruned.effects).toEqual([{ type: "cancel", attempt: 3 }])
    expect(pruned.state.status === "active" && [...pruned.state.sessions.keys()]).toEqual([s2.key])
    expect(play(pruned.state, { type: "sessions.pruned", keep: new Set([s2.key]) }).state).toBe(pruned.state)
  })

  test("disposing ends the subscription, the fetch and every command", () => {
    const state = play(
      createGoalState(),
      { type: "target.attached", ...s1 },
      { type: "command.requested", ...s1, action: "pause" },
    ).state
    const disposed = play(state, { type: "disposed" })

    expect(disposed.effects).toEqual([
      { type: "unsubscribe", subscription: 1 },
      { type: "cancel", attempt: 2 },
      { type: "cancel", attempt: 3 },
    ])
    expect(play(disposed.state, { type: "target.attached", ...s2 }).effects).toEqual([])
  })
})

function pick(session: typeof s1) {
  return { key: session.key, serverID: session.serverID, sessionID: session.sessionID }
}
