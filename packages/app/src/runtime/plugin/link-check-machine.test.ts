import { expect, test } from "bun:test"
import {
  createLinkCheckState,
  transitionLinkCheck,
  type LinkCheckEffect,
  type LinkCheckEvent,
} from "./link-check-machine"

/** Drives the machine as `createLinkCheck` does, recording every effect it asks for. */
function harness(active = true) {
  const machine = { state: createLinkCheckState(active) }
  const effects: LinkCheckEffect[] = []

  const dispatch = (event: LinkCheckEvent) => {
    const next = transitionLinkCheck(machine.state, event)

    machine.state = next.state
    effects.push(...next.effects)

    return next
  }

  return { machine, effects, dispatch }
}

// Before, a check waiting on a hidden timeline, or one whose negative answer came back after the timeline was
// disposed, never settled: its markdown link stayed pending forever.
test("disposing settles every waiting and running check false, and ignores a late answer", () => {
  const run = harness(false)
  const waiting = run.dispatch({ type: "defer", href: "a.ts" }).id
  const running = run.dispatch({ type: "start", href: "b.ts" }).id

  run.dispatch({ type: "disposed" })
  const disposed = run.machine.state
  const late = run.dispatch({ type: "settled", id: running ?? 0, found: false })

  expect(run.effects).toEqual([
    { type: "resolve", id: waiting, value: false },
    { type: "resolve", id: running, value: false },
  ])
  expect(late.state).toBe(disposed)
  expect(late.effects).toEqual([])
})

test("a check deferred while hidden runs on the wake after the timeline is selected", () => {
  const run = harness(false)
  const id = run.dispatch({ type: "defer", href: "a.ts" }).id

  run.dispatch({ type: "sync", active: true })
  run.dispatch({ type: "wake", epoch: 1 })
  expect(run.effects).toEqual([{ type: "schedule.wake", epoch: 0 }])

  run.dispatch({ type: "wake", epoch: 0 })
  run.dispatch({ type: "settled", id: id ?? 0, found: true })
  expect(run.effects.slice(1)).toEqual([
    { type: "check", id, href: "a.ts" },
    { type: "resolve", id, value: true },
  ])
})

test("a wake from a selection that was hidden again before it ran checks nothing", () => {
  const run = harness(false)

  run.dispatch({ type: "defer", href: "a.ts" })
  run.dispatch({ type: "sync", active: true })
  run.dispatch({ type: "sync", active: false })
  const hidden = run.machine.state

  expect(run.dispatch({ type: "wake", epoch: 0 }).state).toBe(hidden)
  run.dispatch({ type: "sync", active: true })
  expect(run.effects).toEqual([
    { type: "schedule.wake", epoch: 0 },
    { type: "schedule.wake", epoch: 1 },
  ])
})

test("a negative answer to a check asked before the latest hide is asked again, now or once selected", () => {
  const shown = harness()
  const again = shown.dispatch({ type: "start", href: "a.ts" }).id

  shown.dispatch({ type: "sync", active: false })
  shown.dispatch({ type: "sync", active: true })
  shown.dispatch({ type: "settled", id: again ?? 0, found: false })
  shown.dispatch({ type: "settled", id: again ?? 0, found: false })
  expect(shown.effects).toEqual([
    { type: "check", id: again, href: "a.ts" },
    { type: "resolve", id: again, value: false },
  ])

  const hidden = harness()
  const waits = hidden.dispatch({ type: "start", href: "b.ts" }).id

  hidden.dispatch({ type: "sync", active: false })
  hidden.dispatch({ type: "settled", id: waits ?? 0, found: false })
  expect(hidden.machine.state).toMatchObject({ status: "hidden", running: [], waiting: [{ id: waits, href: "b.ts" }] })
  expect(hidden.effects).toEqual([])
})

test("a positive answer resolves even while hidden, and a failure rejects once", () => {
  const run = harness()
  const found = run.dispatch({ type: "start", href: "a.ts" }).id
  const broken = run.dispatch({ type: "start", href: "b.ts" }).id
  const cause = new Error("offline")

  run.dispatch({ type: "sync", active: false })
  run.dispatch({ type: "settled", id: found ?? 0, found: true })
  run.dispatch({ type: "failed", id: broken ?? 0, cause })
  const settled = run.machine.state

  expect(run.dispatch({ type: "failed", id: broken ?? 0, cause }).state).toBe(settled)
  expect(run.effects).toEqual([
    { type: "resolve", id: found, value: true },
    { type: "reject", id: broken, cause },
  ])
})
