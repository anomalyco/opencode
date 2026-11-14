import { describe, expect, test } from "bun:test"
import {
  createShellFollowerState,
  SHELL_EXITED_MAX_RETRIES,
  transitionShellFollower,
  type ShellFollowerEffect,
  type ShellFollowerEvent,
  type ShellFollowerState,
} from "./shell-output-machine"

function replay(events: ShellFollowerEvent[], state: ShellFollowerState) {
  return events.reduce((current, event) => transitionShellFollower(current, event).state, state)
}

function waits(effects: readonly ShellFollowerEffect[]) {
  return effects.flatMap((effect) => (effect.type === "wait" ? [effect.delayMs] : []))
}

const fresh = (running: boolean) => createShellFollowerState({ cached: undefined, missing: false, running }).state

// Retries a failing read: each failure waits, and each elapsed wait reads again.
function fail(state: ShellFollowerState) {
  if (state.status !== "reading") throw new Error(`expected a read, got ${state.status}`)
  const failed = transitionShellFollower(state, { type: "read.failed", attempt: state.attempt })

  if (failed.state.status !== "waiting") return { state: failed.state, delays: [] }

  return {
    state: transitionShellFollower(failed.state, { type: "wait.elapsed", attempt: failed.state.attempt }).state,
    delays: waits(failed.effects),
  }
}

describe("transitionShellFollower", () => {
  test("retries a failing read of an exited shell before giving up", () => {
    const delays: number[] = []
    let state = fresh(false)

    for (let i = 0; i < SHELL_EXITED_MAX_RETRIES; i++) {
      const next = fail(state)
      delays.push(...next.delays)
      state = next.state
    }

    expect(delays).toEqual([1_000, 2_000, 4_000])
    expect(state).toMatchObject({ status: "reading", failures: 3 })

    // A retry that succeeds still shows the output.
    if (state.status !== "reading") return

    const recovered = transitionShellFollower(state, {
      type: "read.succeeded",
      attempt: state.attempt,
      page: { output: "done\n", cursor: 5, size: 5 },
    })

    expect(recovered.state).toMatchObject({ status: "complete", output: "done\n" })
    expect(recovered.effects).toContainEqual({ type: "emit", output: "done\n" })
    expect(fail(state).state).toEqual({ status: "failed", attempt: state.attempt, cursor: 0, output: "" })
  })

  test("backs off a failing live shell and polls once a read succeeds", () => {
    const delays: number[] = []
    let state = fresh(true)

    for (let i = 0; i < 6; i++) {
      const next = fail(state)
      delays.push(...next.delays)
      state = next.state
    }

    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 16_000])

    if (state.status !== "reading") throw new Error("expected a read")

    const polled = transitionShellFollower(state, {
      type: "read.succeeded",
      attempt: state.attempt,
      page: { output: "up\n", cursor: 3, size: 3 },
    })

    expect(polled.state).toMatchObject({ status: "waiting", failures: 0 })
    expect(waits(polled.effects)).toEqual([1_000])
  })

  test.each([
    ["backing off", "waiting", ["read"]],
    ["reading", "reading", []],
  ] as const)("a shell that stops while %s after failed polls still gets its final reads", (_, status, effects) => {
    let live = fresh(true)

    for (let i = 0; i < 5; i++) live = fail(live).state

    // After five failed polls the follower reads again; one more failure leaves it backing off.
    const before =
      status === "waiting" && live.status === "reading"
        ? transitionShellFollower(live, { type: "read.failed", attempt: live.attempt }).state
        : live

    expect(before).toMatchObject({ status, running: true })

    const stopped = transitionShellFollower(before, { type: "running.changed", running: false })

    expect(stopped.state).toMatchObject({ status: "reading", running: false, failures: 0 })
    expect(stopped.effects.map((effect) => effect.type)).toEqual([...effects])

    const delays: number[] = []
    let state = stopped.state

    for (let i = 0; i < SHELL_EXITED_MAX_RETRIES; i++) {
      const next = fail(state)
      delays.push(...next.delays)
      state = next.state
    }

    expect(delays).toEqual([1_000, 2_000, 4_000])
    expect(fail(state).state).toMatchObject({ status: "failed" })
  })

  test("reads a complete shell again from its cursor once the late inventory says it runs", () => {
    const complete = createShellFollowerState({
      cached: { cursor: 6, output: "hello\n", complete: true },
      missing: false,
      running: false,
    })

    expect(complete.state).toMatchObject({ status: "complete" })
    expect(complete.effects).toEqual([{ type: "emit", output: "hello\n" }])

    const live = transitionShellFollower(complete.state, { type: "running.changed", running: true })

    expect(live.state).toMatchObject({ status: "reading", running: true, cursor: 6 })
    expect(live.effects).toEqual([
      { type: "cache", cursor: 6, output: "hello\n", complete: false },
      { type: "read", attempt: 1, cursor: 6 },
    ])
  })

  test("keeps the read in flight when the shell stops and drains once more", () => {
    const reading = fresh(true)
    const stopped = transitionShellFollower(reading, { type: "running.changed", running: false })

    expect(stopped.effects).toEqual([])
    expect(stopped.state).toMatchObject({ status: "reading", attempt: 1, running: false, final: false })

    const page = transitionShellFollower(stopped.state, {
      type: "read.succeeded",
      attempt: 1,
      page: { output: "a\n", cursor: 2, size: 2 },
    })

    expect(page.state).toMatchObject({ status: "reading", attempt: 2, final: true })
    expect(page.effects).toContainEqual({ type: "emit", output: "a\n" })
    expect(page.effects).toContainEqual({ type: "read", attempt: 2, cursor: 2 })

    const drained = replay(
      [{ type: "read.succeeded", attempt: 2, page: { output: "b\n", cursor: 4, size: 4 } }],
      page.state,
    )

    expect(drained).toMatchObject({ status: "complete", cursor: 4, output: "a\nb\n" })
  })

  test("reads the final output at once when a polled shell stops", () => {
    const polling = replay(
      [{ type: "read.succeeded", attempt: 1, page: { output: "a", cursor: 1, size: 1 } }],
      fresh(true),
    )

    const stopped = transitionShellFollower(polling, { type: "running.changed", running: false })

    expect(stopped.state).toMatchObject({ status: "reading", attempt: 3, final: true })
    expect(stopped.effects).toEqual([{ type: "read", attempt: 3, cursor: 1 }])
  })

  test("a missing shell is remembered and never read again", () => {
    const missing = transitionShellFollower(fresh(true), { type: "read.missing", attempt: 1 })

    expect(missing.state).toMatchObject({ status: "missing" })
    expect(missing.effects).toEqual([{ type: "cancel" }, { type: "cache-missing" }])
    expect(transitionShellFollower(missing.state, { type: "running.changed", running: true }).state).toBe(missing.state)
    expect(createShellFollowerState({ cached: undefined, missing: true, running: true })).toEqual({
      state: { status: "missing", attempt: 0, cursor: 0, output: "" },
      effects: [],
    })
  })

  test("ignores stale results and everything after dispose", () => {
    const polling = replay(
      [{ type: "read.succeeded", attempt: 1, page: { output: "a", cursor: 1, size: 1 } }],
      fresh(true),
    )

    const stale: ShellFollowerEvent[] = [
      { type: "read.succeeded", attempt: 1, page: { output: "x", cursor: 9, size: 9 } },
      { type: "read.failed", attempt: 1 },
      { type: "read.missing", attempt: 1 },
      { type: "wait.elapsed", attempt: 1 },
      { type: "running.changed", running: true },
    ]

    stale.forEach((event) => expect(transitionShellFollower(polling, event).state).toBe(polling))

    const disposed = transitionShellFollower(polling, { type: "disposed" })

    expect(disposed).toEqual({ state: { status: "disposed" }, effects: [{ type: "cancel" }] })
    expect(transitionShellFollower(disposed.state, { type: "wait.elapsed", attempt: 2 }).state).toBe(disposed.state)
    expect(transitionShellFollower(disposed.state, { type: "running.changed", running: false }).state).toBe(
      disposed.state,
    )
  })
})
